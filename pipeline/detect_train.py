"""Train the card detector (PLAN.md §5.7). CPU; run it in your own terminal (Claude Code's
low-memory guard stops long jobs):

  cd pipeline; $env:PYTHONUTF8="1"
  .\\.venv\\Scripts\\python -u detect_train.py --steps 3000 --workers 2 --log out\\detect\\train.log
  (add --resume to continue from out/detect/last.pt)

Batches mix online synthetic composites (detect_synth) with the human's real labelled train frames.
Checkpoint selection uses held-out real frames (every DETECT_VAL_EVERY-th by capture time) when
there are any, else a fixed synthetic validation set. Best → out/detect/best.pt.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

import config
from augment import load_rgb
from detect_data import RealFrame, load_real
from detect_model import CardDetector, detector_loss
from detect_synth import DetectSource, default_source
from finetune import Tee

OUT = config.DETECT_WEIGHTS.parent
SYNTH_VAL = 200
SYNTH_VAL_SEED = 999


def split_real(frames: list[RealFrame]) -> tuple[list[RealFrame], list[RealFrame]]:
    """Every DETECT_VAL_EVERY-th card frame and empty frame (by capture time) → validation."""
    train, val = [], []
    for group in ([f for f in frames if f.corners], [f for f in frames if not f.corners]):
        for i, f in enumerate(group):
            (val if i % config.DETECT_VAL_EVERY == config.DETECT_VAL_EVERY - 1 else train).append(f)
    return train, val


def to_tensor(img: np.ndarray) -> torch.Tensor:
    return torch.from_numpy(np.ascontiguousarray(img)).permute(2, 0, 1).float() / 255.0


class Stream(Dataset):
    """Sample i of the run = src.sample(seed, i); map-style so workers stay deterministic."""

    def __init__(self, src: DetectSource, seed: int, start: int, length: int):
        self.src, self.seed, self.start, self.length = src, seed, start, length

    def __len__(self) -> int:
        return self.length

    def __getitem__(self, i: int):
        s = self.src.sample(self.seed, self.start + i)
        return to_tensor(s.image), torch.from_numpy(s.corners), torch.tensor(s.present, dtype=torch.float32)


def real_val_batch(frames: list[RealFrame]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    import cv2
    xs, cs, ps, hs = [], [], [], []
    for f in frames:
        img = cv2.resize(load_rgb(f.png), (config.DETECT_W, config.DETECT_H), interpolation=cv2.INTER_AREA)
        xs.append(to_tensor(img))
        c = np.array(f.corners, np.float32) / np.array([f.width, f.height], np.float32) if f.corners else np.zeros((4, 2), np.float32)
        cs.append(torch.from_numpy(c))
        ps.append(1.0 if f.corners else 0.0)
        hs.append(float(f.height))
    return torch.stack(xs), torch.stack(cs), torch.tensor(ps), torch.tensor(hs)


@torch.no_grad()
def evaluate(model: CardDetector, x, corners, present, frame_h) -> dict:
    """Present accuracy + mean corner error as a fraction of the card's height (positives only)."""
    model.eval()
    logits, pred = [], []
    for i in range(0, len(x), 32):
        lg, cn = model(x[i:i + 32])
        logits.append(lg)
        pred.append(cn)
    logit, pred = torch.cat(logits), torch.cat(pred)
    acc = ((logit.sigmoid() > config.DETECT_PRESENT_T).float() == present).float().mean().item()
    pos = present > 0.5
    err = float("nan")
    if pos.any():
        # pixels in the original frame: y scale = frame height; x scale uses the frame's width = h * W/H of the input stretch
        gt, pr = corners[pos], pred[pos]
        scale = torch.stack([frame_h[pos] * config.DETECT_W / config.DETECT_H, frame_h[pos]], -1)[:, None, :]
        d = ((pr - gt) * scale).norm(dim=-1).mean(1)  # mean corner distance, px
        card_h = (((gt[:, 3] - gt[:, 0]) * scale[:, 0]).norm(dim=-1) + ((gt[:, 2] - gt[:, 1]) * scale[:, 0]).norm(dim=-1)) / 2
        err = (d / card_h).mean().item()
    model.train()
    return {"present_acc": acc, "corner_err": err, "n": len(x), "positives": int(pos.sum())}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--backbone-lr", type=float, default=3e-4)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--log", type=Path)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.log:
        args.log.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = Tee(sys.stdout, args.log)
    torch.manual_seed(config.SEED)
    torch.set_num_threads(max(1, torch.get_num_threads() - args.workers))

    frames = load_real(config.DETECT_REAL_DIR) if config.DETECT_REAL_DIR.exists() else []
    train_real, val_real = split_real(frames)
    src = default_source(train_real)
    src.empty_frames = [e for e, f in zip(src.empty_frames, [f for f in frames if not f.corners]) if f in train_real]
    print(f"real frames: {sum(1 for f in train_real if f.corners)} card + {sum(1 for f in train_real if not f.corners)} "
          f"empty for training, {len(val_real)} held out; {len(src.card_images)} card images")

    synth = [src.synthetic(np.random.default_rng([SYNTH_VAL_SEED, i])) for i in range(SYNTH_VAL)]
    sval = (torch.stack([to_tensor(s.image) for s in synth]), torch.stack([torch.from_numpy(s.corners) for s in synth]),
            torch.tensor([s.present for s in synth]), torch.full((SYNTH_VAL,), float(config.DETECT_H)))
    rval = real_val_batch(val_real) if val_real else None

    model = CardDetector(pretrained=True)
    head = [p for n, p in model.named_parameters() if not n.startswith("backbone.")]
    opt = torch.optim.AdamW([{"params": model.backbone.parameters(), "lr": args.backbone_lr},
                             {"params": head, "lr": args.lr}], weight_decay=1e-4)
    start, best = 0, None
    if args.resume and (OUT / "last.pt").exists():
        ck = torch.load(OUT / "last.pt", map_location="cpu")
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        start, best = ck["step"], ck.get("best")
        print(f"resumed at step {start}, best {best}")
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[args.backbone_lr, args.lr], total_steps=args.steps,
                                                pct_start=0.1, last_epoch=start - 1 if start else -1)

    loader = DataLoader(Stream(src, config.SEED, start * args.batch, (args.steps - start) * args.batch),
                        batch_size=args.batch, num_workers=args.workers, persistent_workers=args.workers > 0)
    model.train()
    t0, run = time.time(), {"bce": 0.0, "l1": 0.0, "js": 0.0}
    for step, (x, corners, present) in enumerate(loader, start=start + 1):
        loss, parts = detector_loss(model, x, corners, present)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        for k in run:
            run[k] += parts[k]
        if step % 25 == 0:
            avg = {k: round(v / 25, 4) for k, v in run.items()}
            print(f"step {step}/{args.steps}  {avg}  {(time.time() - t0) / (step - start):.2f}s/step", flush=True)
            run = dict.fromkeys(run, 0.0)
        if step % args.eval_every == 0 or step == args.steps:
            r = {"step": step, "synth": evaluate(model, *sval)}
            if rval is not None:
                r["real"] = evaluate(model, *rval)
            key_src = r.get("real", r["synth"])
            key = (round(key_src["present_acc"], 3), -key_src["corner_err"] if key_src["corner_err"] == key_src["corner_err"] else 0)
            print("eval", json.dumps(r), flush=True)
            if best is None or key > tuple(best["key"]):
                best = {"key": list(key), "step": step, **r}
                torch.save(model.state_dict(), config.DETECT_WEIGHTS)
                print(f"  new best -> {config.DETECT_WEIGHTS}", flush=True)
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "step": step, "best": best}, OUT / "last.pt")
    print("done. best:", json.dumps(best))


if __name__ == "__main__":
    main()

"""Fine-tune the embedder with metric learning (PLAN.md §6 "If accuracy is below 90%", step 4).

Problem (NOTES, Phase 3): the ImageNet backbone embeds the card *frame* more than the art, so a
camera shot of one Spell lands closer to other Spells than to its own reference.

Training:
  * class = one distinct picture (card name + canonical image hash); foils share their base picture
  * batch = P classes × K augmented views (same augment() as embed.py, different indices)
  * half the classes in each batch are hard negatives: nearest neighbours of the other half
    under the *pretrained* embedding (same frame / same card type / look-alike siblings)
  * loss = supervised contrastive (SupCon) on the L2-normalized embedding, temperature TAU
  * BatchNorm frozen (small CPU batches), AdamW, cosine LR
  * every EVAL_EVERY steps: top-1 retrieval of held-out augmentations vs clean references;
    best checkpoint → pipeline/out/finetune/best.pt  (model.py loads it if present)

Usage:
  python finetune.py --time        # measure seconds/step, then exit
  python finetune.py --steps 1500  # train
"""
from __future__ import annotations

import argparse
import sys
import json
import math
import random
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset, Sampler

import config
from augment import augment, load_rgb, to_model_size
from cardsio import read_csv
from model import Embedder

OUT = config.OUT_DIR / "finetune"
TAU = 0.07
EVAL_AUG_OFFSET = 10_000  # augmentation indices used only for evaluation (training uses < this)


class Tee:
    """Print to the console and append to a UTF-8 log file (PowerShell 5.1 redirects write UTF-16)."""

    def __init__(self, stream, path: Path):
        self.stream, self.file = stream, open(path, "a", encoding="utf-8")

    def write(self, text: str) -> int:
        self.file.write(text)
        self.file.flush()
        return self.stream.write(text)

    def flush(self) -> None:
        self.stream.flush()
        self.file.flush()


def picture_classes() -> list[dict]:
    """One entry per distinct picture: representative printing + all its printing ids."""
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in read_csv(config.CARDS_CSV):
        if c["variant"] != "foil":
            groups[(c["name"], c["image_hash"])].append(c)
    classes = []
    for (name, h), cs in sorted(groups.items()):
        classes.append({"name": name, "hash": h, "rep": cs[0], "ids": [c["printing_id"] for c in cs]})
    return classes


def hard_neighbours(classes: list[dict], k: int) -> list[list[int]]:
    """k nearest *other* classes per class under the current (pretrained) clean embeddings."""
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4").reshape(meta["rows"], meta["dim"])
    ids = json.loads((config.APP_DATA / "embedding_ids.json").read_text(encoding="utf-8"))
    per = meta["rowsPerPrinting"]
    row0 = {pid: i for i, pid in enumerate(ids) if i % per == 0}
    clean = np.stack([emb[row0[c["rep"]["printing_id"]]] for c in classes])
    sims = clean @ clean.T
    np.fill_diagonal(sims, -np.inf)
    return [list(np.argsort(-sims[i])[:k]) for i in range(len(classes))]


class Views(Dataset):
    """(class index, augmentation index) → model-size float tensor."""

    def __init__(self, classes: list[dict]):
        self.classes = classes

    def __len__(self) -> int:
        return len(self.classes)

    def __getitem__(self, key: tuple[int, int]):
        ci, aug = key
        rep = self.classes[ci]["rep"]
        clean = load_rgb(config.IMAGES_DIR / rep["image_file"])
        img = to_model_size(clean) if aug < 0 else augment(clean, rep["printing_id"], aug)
        return torch.from_numpy(img.astype(np.float32) / 255.0).permute(2, 0, 1), ci


class PKSampler(Sampler):
    """Yields batches of P classes × K views; half the classes are hard neighbours of the other half."""

    def __init__(self, n_classes: int, neighbours: list[list[int]], p: int, k: int, steps: int, seed: int):
        self.n, self.nb, self.p, self.k, self.steps = n_classes, neighbours, p, k, steps
        self.rng = random.Random(seed)
        self.aug_counter = 0

    def __len__(self) -> int:
        return self.steps

    def __iter__(self):
        for _ in range(self.steps):
            anchors = self.rng.sample(range(self.n), self.p // 2)
            chosen = list(dict.fromkeys(anchors + [self.rng.choice(self.nb[a]) for a in anchors]))
            while len(chosen) < self.p:
                c = self.rng.randrange(self.n)
                if c not in chosen:
                    chosen.append(c)
            batch = []
            for c in chosen:
                for _ in range(self.k):
                    batch.append((c, self.aug_counter % EVAL_AUG_OFFSET))
                    self.aug_counter += 1
            yield batch


def supcon(z: torch.Tensor, labels: torch.Tensor, tau: float = TAU) -> torch.Tensor:
    """Supervised contrastive loss (Khosla et al. 2020) on L2-normalized z."""
    sim = z @ z.T / tau
    eye = torch.eye(len(z), dtype=torch.bool)
    sim = sim.masked_fill(eye, -1e9)
    pos = (labels[:, None] == labels[None, :]) & ~eye
    log_prob = sim - torch.logsumexp(sim, dim=1, keepdim=True)
    return -(log_prob * pos).sum(1).div(pos.sum(1).clamp(min=1)).mean()


def freeze_bn(model: nn.Module) -> None:
    for m in model.modules():
        if isinstance(m, nn.modules.batchnorm._BatchNorm):
            m.eval()
            for p in m.parameters():
                p.requires_grad_(False)


def real_photos(classes: list[dict]) -> list[tuple[torch.Tensor, int]]:
    """Human capture-mode photos (data/eval/<printing_id>/*.png) as (tensor, class index)."""
    cls_of = {pid: i for i, c in enumerate(classes) for pid in c["ids"]}
    out = []
    for path in sorted(config.EVAL_DIR.glob("*/*.png")):
        ci = cls_of.get(path.parent.name)
        if ci is None:
            continue
        rgb = np.asarray(Image.open(path).convert("RGB").resize((config.INPUT_W, config.INPUT_H), Image.BILINEAR))
        out.append((torch.from_numpy(rgb.astype(np.float32) / 255.0).permute(2, 0, 1), ci))
    return out


@torch.no_grad()
def evaluate(model: Embedder, ds: Views, eval_classes: list[int], real: list, n_aug: int = 2) -> dict:
    """Top-1 retrieval vs clean refs of *all* classes: held-out augmentations, and real photos."""
    model.eval()
    refs = torch.cat([model(torch.stack([ds[(c, -1)][0] for c in chunk]))
                      for chunk in np.array_split(np.arange(len(ds)), max(1, len(ds) // 64))])
    real_top1 = real_rank = None
    if real:
        s = model(torch.stack([x for x, _ in real])) @ refs.T
        truth = torch.tensor([c for _, c in real])
        own = s[torch.arange(len(real)), truth]
        ranks = (s > own[:, None]).sum(1) + 1
        real_top1 = float((ranks == 1).float().mean())
        real_rank = float(ranks.float().median())
    hits = total = 0
    margins = []
    for c in eval_classes:
        x = torch.stack([ds[(c, EVAL_AUG_OFFSET + j)][0] for j in range(n_aug)])
        s = model(x) @ refs.T
        own = s[:, c].clone()
        s[:, c] = -1
        other = s.max(1).values
        hits += int((own > other).sum())
        total += n_aug
        margins += (own - other).tolist()
    return {"real_top1": real_top1, "real_median_rank": real_rank, "top1": hits / total,
            "margin_mean": float(np.mean(margins)), "margin_p10": float(np.percentile(margins, 10)), "_refs": refs}


def mine_neighbours(refs: torch.Tensor, k: int) -> list[list[int]]:
    """Online hard negatives: the k nearest other classes under the *current* model."""
    sims = refs @ refs.T
    sims.fill_diagonal_(-float("inf"))
    return sims.topk(k, dim=1).indices.tolist()


def score_key(r: dict) -> tuple:
    """Checkpoint selection: real photos first (when there are any), then synthetic retrieval."""
    return (r["real_top1"] if r["real_top1"] is not None else 0.0, r["top1"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--p", type=int, default=24, help="classes per batch")
    ap.add_argument("--k", type=int, default=2, help="views per class")
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--resume", action="store_true", help="start from FINETUNED_WEIGHTS (backed up first)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--eval-classes", type=int, default=300)
    ap.add_argument("--time", action="store_true", help="time a few steps and exit")
    ap.add_argument("--log", type=Path, default=None, help="also write output to this file (UTF-8)")
    args = ap.parse_args()
    if args.log:
        sys.stdout = Tee(sys.stdout, args.log)

    torch.manual_seed(config.SEED)
    torch.set_num_threads(max(1, torch.get_num_threads()))
    classes = picture_classes()
    neighbours = hard_neighbours(classes, k=10)
    ds = Views(classes)
    steps = 6 if args.time else args.steps
    sampler = PKSampler(len(classes), neighbours, args.p, args.k, steps, config.SEED)
    loader = DataLoader(ds, batch_sampler=sampler, num_workers=args.workers, persistent_workers=args.workers > 0)
    eval_classes = random.Random(config.SEED + 1).sample(range(len(classes)), min(args.eval_classes, len(classes)))

    model = Embedder()
    if args.resume:
        if not config.FINETUNED_WEIGHTS.exists():
            raise SystemExit(f"--resume: {config.FINETUNED_WEIGHTS} not found")
        backup = config.FINETUNED_WEIGHTS.with_name(f"best_before_resume_{time.strftime('%Y%m%dT%H%M%S')}.pt")
        backup.write_bytes(config.FINETUNED_WEIGHTS.read_bytes())
        model.load_state_dict(torch.load(config.FINETUNED_WEIGHTS, map_location="cpu"))
        print(f"resumed from {config.FINETUNED_WEIGHTS.name} (backup: {backup.name})")
    freeze_bn(model)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: 0.5 * (1 + math.cos(math.pi * min(s, steps) / steps)))
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{len(classes)} picture classes, batch {args.p}x{args.k}, {steps} steps, torch threads {torch.get_num_threads()}")

    real = real_photos(classes)
    print(f"real validation photos: {len(real)}")
    if not args.time:
        base = evaluate(model, ds, eval_classes, real)
        sampler.nb = mine_neighbours(base.pop("_refs"), k=10)
        print(f"step 0 (pretrained): {base}", flush=True)
        best = score_key(base)
        log = [{"step": 0, **base}]

    t0 = time.time()
    for step, (x, y) in enumerate(loader, 1):
        model.train()
        freeze_bn(model)
        loss = supcon(model(x), y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if args.time:
            print(f"  step {step}: loss {loss.item():.3f}  {(time.time() - t0) / step:.2f}s/step")
            continue
        if step % 25 == 0:
            rate = (time.time() - t0) / step
            print(f"step {step}/{steps} loss {loss.item():.3f}  {rate:.2f}s/step  ~{(steps - step) * rate / 60:.0f} min left", flush=True)
        if step % args.eval_every == 0 or step == steps:
            r = evaluate(model, ds, eval_classes, real)
            sampler.nb = mine_neighbours(r.pop("_refs"), k=10)  # keep batches hard as the model improves
            log.append({"step": step, "loss": loss.item(), **r})
            print(f"eval step {step}: {r}", flush=True)
            if score_key(r) >= best:
                best = score_key(r)
                torch.save(model.state_dict(), OUT / "best.pt")
                print(f"  saved best {best}", flush=True)
            (OUT / "log.json").write_text(json.dumps(log, indent=1), encoding="utf-8")

    if args.time:
        per = (time.time() - t0) / steps
        print(f"~{per:.2f}s/step (includes worker start-up) -> 1500 steps ~ {1500 * per / 60:.0f} min")


if __name__ == "__main__":
    main()

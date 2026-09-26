"""Accuracy on real camera photos + threshold calibration (PLAN.md §6.8).

Photos: data/eval/<printing_id>/*.png — 224×320 crops saved by the app's capture mode.
Each photo goes through the same path as the app: ONNX embedding → best score per printing →
layout scores → decide.py (Python mirror of decide.ts), in the pack mode matching its pool.

Correctness: an accepted printing is right if it has the truth's card name AND picture (same
image hash) — identical pictures (foil, reprints) can't be told apart by design.

Usage:
  python eval.py                 # report at the current thresholds
  python eval.py --calibrate     # also sweep thresholds / weights and recommend values
  python eval.py --model PATH    # evaluate a different embedder.onnx (needs matching embeddings)
"""
from __future__ import annotations

import argparse
import itertools
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

import config
from decide import DecideConfig, decide, index_cards
from export_onnx import session, to_tensor
from layout import layout_score, signature


@dataclass
class Photo:
    path: Path
    truth: str
    scores: dict[str, float]
    layout: dict[str, float]  # printing id → layout score (look-alike printings only)
    rank: int                 # rank of the truth's picture group among printings (1 = best)


def load_reference():
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4").reshape(meta["rows"], meta["dim"])
    ids = json.loads((config.APP_DATA / "embedding_ids.json").read_text(encoding="utf-8"))
    lay_ids = json.loads((config.APP_DATA / "layout_ids.json").read_text(encoding="utf-8"))
    lay = np.fromfile(config.APP_DATA / "layout.bin", dtype="<f4").reshape(len(lay_ids), -1)
    cards = json.loads((config.APP_DATA / "cards.json").read_text(encoding="utf-8"))
    prices = {p["printingId"]: p["priceUsd"] for p in json.loads((config.APP_DATA / "prices.json").read_text(encoding="utf-8"))}
    return emb, ids, dict(zip(lay_ids, lay)), cards, prices


def score_photos(model_path: Path | None) -> tuple[list[Photo], dict, dict, dict]:
    emb, ids, lay_rows, cards, prices = load_reference()
    by_id, by_name = index_cards(cards)
    uniq, inv = np.unique(np.array(ids), return_inverse=True)
    sess = session(model_path)
    photos = []
    for path in sorted(config.EVAL_DIR.glob("*/*.png")):
        truth = path.parent.name
        if truth not in by_id:
            print(f"  skip {path.name}: unknown printing {truth}")
            continue
        rgb = np.asarray(Image.open(path).convert("RGB").resize((config.INPUT_W, config.INPUT_H), Image.BILINEAR))
        q = sess.run(["embedding"], {"input": to_tensor(rgb)})[0][0]
        row = emb @ q
        best = np.full(len(uniq), -np.inf, dtype=np.float32)
        np.maximum.at(best, inv, row)
        scores = dict(zip(uniq.tolist(), best.tolist()))
        sig = signature(rgb)
        layout = {pid: layout_score(sig, v) for pid, v in lay_rows.items()
                  if by_id.get(pid, {}).get("name") in {by_id[truth]["name"], *top_names(scores, by_id, 5)}}
        t = by_id[truth]
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        rank = next(i for i, (pid, _) in enumerate(ranked, 1)
                    if by_id[pid]["name"] == t["name"] and by_id[pid]["imageHash"] == t["imageHash"])
        photos.append(Photo(path, truth, scores, layout, rank))
    return photos, by_id, by_name, prices


def top_names(scores: dict[str, float], by_id: dict, n: int) -> set[str]:
    return {by_id[pid]["name"] for pid, _ in sorted(scores.items(), key=lambda x: -x[1])[:n]}


def run_all(photos, by_id, by_name, prices, cfg: DecideConfig):
    out = []
    for p in photos:
        mode = by_id[p.truth]["pool"]  # the user sets the pack mode that matches the pack
        d = decide(p.scores, by_id, by_name, prices, mode, lambda i, p=p: p.layout.get(i), cfg)
        out.append((p, d))
    return out


def verdict(p: Photo, d, by_id) -> str:
    t = by_id[p.truth]
    same = lambda pid: by_id[pid]["name"] == t["name"] and by_id[pid]["imageHash"] == t["imageHash"]  # noqa: E731
    if d.status == "rejected":
        return "rejected"
    if d.status == "ask":
        return "ask_ok" if any(same(o) for o in d.ask_options) else "ask_wrong"
    if same(d.best):
        return "correct"
    return "wrong_printing" if by_id[d.best]["name"] == t["name"] else "wrong_card"


def is_hard(truth: str, by_id, by_name) -> bool:
    name = by_id[truth]["name"]
    return len({c["imageHash"] for c in by_name[name] if c["variant"] != "foil"}) > 1


def report(results, by_id, by_name, label: str) -> Counter:
    v = Counter(verdict(p, d, by_id) for p, d in results)
    n = len(results)
    ranks = [p.rank for p, _ in results]
    print(f"\n=== {label}: {n} photos, {len({p.truth for p, _ in results})} printings")
    print(f"top-1 (rank of true picture = 1): {sum(r == 1 for r in ranks) / n:.1%}   "
          f"top-5: {sum(r <= 5 for r in ranks) / n:.1%}   median rank {int(np.median(ranks))}")
    print(f"decisions: correct {v['correct']}  wrong_card {v['wrong_card']}  wrong_printing {v['wrong_printing']}  "
          f"ask {v['ask_ok'] + v['ask_wrong']} (wrong options {v['ask_wrong']})  rejected {v['rejected']}")
    print(f"accept rate {(v['correct'] + v['wrong_card'] + v['wrong_printing']) / n:.1%}   "
          f"WRONG ACCEPTS {v['wrong_card'] + v['wrong_printing']}")
    hard = [(p, d) for p, d in results if is_hard(p.truth, by_id, by_name)]
    if hard:
        hv = Counter(verdict(p, d, by_id) for p, d in hard)
        print(f"hard pairs ({len(hard)} photos): correct {hv['correct']}  WRONG PRINTING {hv['wrong_printing']}  "
              f"ask {hv['ask_ok'] + hv['ask_wrong']} ({(hv['ask_ok'] + hv['ask_wrong']) / len(hard):.0%})")
    conf = Counter((p.truth, d.best) for p, d in results if verdict(p, d, by_id) in ("wrong_card", "wrong_printing"))
    for (t, b), k in conf.most_common(10):
        print(f"  wrong: {t} ({by_id[t]['name']}) -> {b} ({by_id[b]['name']}) x{k}")
    low = sorted(results, key=lambda x: -x[0].rank)[:5]
    for p, d in low:
        if p.rank > 1:
            top = ", ".join(f"{pid}:{s:.3f}" for pid, s in d.top[:3])
            print(f"  worst rank {p.rank:3d}: {p.path.parent.name}/{p.path.name}  top: {top}")
    return v


def calibrate(photos, by_id, by_name, prices) -> None:
    print("\n=== calibration")
    rows = []
    for a, m in itertools.product(np.arange(0.40, 0.91, 0.02), np.arange(0.00, 0.16, 0.01)):
        cfg = DecideConfig(ACCEPT_T=float(a), MARGIN_T=float(m))
        v = Counter(verdict(p, d, by_id) for p, d in run_all(photos, by_id, by_name, prices, cfg))
        wrong_names = v["wrong_card"]
        accepted = v["correct"] + v["wrong_card"] + v["wrong_printing"]
        rows.append((wrong_names, -accepted, a, m, v))
    rows.sort(key=lambda r: (r[0], r[1], -r[2]))
    wn, acc, a, m, v = rows[0]
    print(f"step 1 (names): ACCEPT_T={a:.2f} MARGIN_T={m:.2f} -> wrong-name accepts {wn}, accepted {-acc}/{len(photos)}")

    hard = [p for p in photos if is_hard(p.truth, by_id, by_name)]
    if not hard:
        print("step 2 skipped: no hard-pair photos yet")
        return
    best = None
    for w, lm in itertools.product(np.arange(0.0, 1.01, 0.1), np.arange(0.0, 0.11, 0.01)):
        cfg = DecideConfig(ACCEPT_T=float(a), MARGIN_T=float(m), EMBED_WEIGHT=float(1 - w), LAYOUT_WEIGHT=float(w),
                           LAYOUT_MARGIN_T=float(lm))
        hv = Counter(verdict(p, d, by_id) for p, d in run_all(hard, by_id, by_name, prices, cfg))
        key = (hv["wrong_printing"], hv["ask_ok"] + hv["ask_wrong"], -hv["correct"])
        if best is None or key < best[0]:
            best = (key, w, lm, hv)
    (wp, asks, _), w, lm, hv = best
    print(f"step 2 (printings, {len(hard)} hard photos): LAYOUT_WEIGHT={w:.1f} EMBED_WEIGHT={1 - w:.1f} "
          f"LAYOUT_MARGIN_T={lm:.2f} -> wrong printings {wp}, asks {asks} ({asks / len(hard):.0%})")
    print("Update app/src/config.ts CFG and pipeline/config.py EMBED_WEIGHT/LAYOUT_WEIGHT with these, then re-run eval.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--model", type=Path, default=None, help="embedder.onnx to evaluate (default: app model)")
    args = ap.parse_args()
    photos, by_id, by_name, prices = score_photos(args.model)
    if not photos:
        raise SystemExit(f"No eval photos in {config.EVAL_DIR}. Capture with the app (C) and run sort_eval.py.")
    per = Counter(p.truth for p in photos)
    print(f"{len(photos)} photos, {len(per)} printings (target >= 60 photos, >= 20 printings x 3)")
    cfg = DecideConfig(EMBED_WEIGHT=config.EMBED_WEIGHT, LAYOUT_WEIGHT=config.LAYOUT_WEIGHT)
    report(run_all(photos, by_id, by_name, prices, cfg), by_id, by_name, "current thresholds")
    if args.calibrate:
        calibrate(photos, by_id, by_name, prices)


if __name__ == "__main__":
    main()

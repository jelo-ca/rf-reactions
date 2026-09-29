"""Evaluate the card detector on the human's real labelled frames (PLAN.md §5.7 acceptance).

Usage: python detect_eval.py [--split val|all] [--weights out/detect/best_v1.pt]
(default split val = the held-out frames detect_train uses; default weights = out/detect/best.pt)
Prints present accuracy (all frames, empties separately) and corner error as a fraction of the
card's height, and writes pipeline/out/detect_eval.png: green = label, red = prediction.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
import torch

import config
from augment import load_rgb
from detect_data import load_real
from detect_model import load_detector
from detect_train import real_val_batch, split_real

ACCEPT_PRESENT_ACC = 0.95
ACCEPT_CORNER_ERR = 0.03


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["val", "all"], default="val")
    ap.add_argument("--weights", type=Path, default=config.DETECT_WEIGHTS, help="compare models on the same frames")
    args = ap.parse_args()
    frames = load_real(config.DETECT_REAL_DIR)
    if args.split == "val":
        frames = split_real(frames)[1]
    if not frames:
        raise SystemExit("no labelled frames - capture with F in capture mode, then run sort_detect.py")
    model = load_detector(args.weights)
    print(f"weights: {args.weights}")
    x, corners, present, frame_h = real_val_batch(frames)
    with torch.no_grad():
        logit, pred = model(x)
    prob = logit.sigmoid()
    said = prob > config.DETECT_PRESENT_T
    truth = present > 0.5

    rows, errs, pxs, heights = [], [], [], []
    for i, f in enumerate(frames):
        err = None
        if truth[i]:
            scale = np.array([f.width, f.height], np.float32)
            gt, pr = corners[i].numpy() * scale, pred[i].numpy() * scale
            card_h = (np.linalg.norm(gt[3] - gt[0]) + np.linalg.norm(gt[2] - gt[1])) / 2
            px = float(np.linalg.norm(pr - gt, axis=1).mean())
            err = px / card_h
            errs.append(err)
            pxs.append(px)
            heights.append(card_h)
        rows.append((f, float(prob[i]), err))

    acc = float((said == truth).float().mean())
    fp = int((said & ~truth).sum())
    fn = int((~said & truth).sum())
    print(f"{len(frames)} frames ({int(truth.sum())} card, {int((~truth).sum())} empty), split={args.split}")
    print(f"present accuracy {acc:.1%}  (false 'card' on empty: {fp}, missed cards: {fn})   bar >= {ACCEPT_PRESENT_ACC:.0%}")
    if errs:
        print(f"corner error: mean {np.mean(errs):.1%}, median {np.median(errs):.1%}, worst {max(errs):.1%} of card height   "
              f"bar <= {ACCEPT_CORNER_ERR:.0%}")
        print(f"  in frame pixels: mean {np.mean(pxs):.1f} px, worst {max(pxs):.1f} px; card heights {min(heights):.0f}-{max(heights):.0f} px")
    sheet(rows, pred)


def sheet(rows, pred, cols: int = 6, tile_w: int = 320) -> None:
    tiles = []
    for i, (f, p, err) in enumerate(rows):
        img = np.ascontiguousarray(load_rgb(f.png))
        s = tile_w / f.width
        img = cv2.resize(img, (tile_w, int(f.height * s)), interpolation=cv2.INTER_AREA)
        if f.corners:
            cv2.polylines(img, [(np.array(f.corners) * s).astype(np.int32)], True, (0, 255, 0), 2, cv2.LINE_AA)
        if p > config.DETECT_PRESENT_T:
            q = (pred[i].numpy() * np.array([f.width, f.height]) * s).astype(np.int32)
            cv2.polylines(img, [q], True, (255, 0, 0), 2, cv2.LINE_AA)
        label = f"p={p:.2f}" + (f" err={err:.0%}" if err is not None else "")
        cv2.putText(img, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(img, label, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(img)
    h = max(t.shape[0] for t in tiles)
    tiles = [cv2.copyMakeBorder(t, 0, h - t.shape[0], 0, 0, cv2.BORDER_CONSTANT) for t in tiles]
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    grid = np.concatenate([np.concatenate(tiles[r:r + cols], axis=1) for r in range(0, len(tiles), cols)], axis=0)
    out = config.OUT_DIR / "detect_eval.png"
    cv2.imwrite(str(out), grid[..., ::-1])
    print(f"sheet: {out} (green = your label, red = model)")


if __name__ == "__main__":
    main()

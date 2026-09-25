"""Layout signatures for look-alike printings (PLAN.md §4.7a).

Must match app/src/vision/layout.ts exactly. Input: the 224×320 RGB image the model sees.
  1. gray = 0.299 R + 0.587 G + 0.114 B, in [0, 1]
  2. 4×4 box average → 56×80 (exact, no resampler)
  3. Sobel gradient magnitude, borders replicated
  4. divide by max(mean, LAYOUT_MIN_MEAN)  (PLAN: mean + 1e-6; a floor stops float noise on
     near-blank images being blown up)
  All math in float64 (JS numbers are float64), stored as float32.
  5. flatten row-major (80 rows × 56 cols)

Only printings whose card name has >1 distinct picture get a row: the decision
rule only calls layoutScore between look-alike picture groups (§6.4 step 7).

Usage: python layout.py   → app/public/data/layout.bin + layout_ids.json, meta.json["layout"]
"""
from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from PIL import Image

import config
from cardsio import read_csv

SOBEL_X = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float64)
SOBEL_Y = SOBEL_X.T


def signature(rgb: np.ndarray) -> np.ndarray:
    """rgb: uint8 [H=320, W=224, 3] → float32 [80*56]."""
    if rgb.shape != (config.INPUT_H, config.INPUT_W, 3):
        raise ValueError(f"expected {(config.INPUT_H, config.INPUT_W, 3)}, got {rgb.shape}")
    x = rgb.astype(np.float64) / 255.0
    gray = 0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2]
    f = config.INPUT_W // config.LAYOUT_W  # 4
    small = gray.reshape(config.LAYOUT_H, f, config.LAYOUT_W, f).mean(axis=(1, 3))
    p = np.pad(small, 1, mode="edge")
    gx = np.zeros_like(small)
    gy = np.zeros_like(small)
    for dy in range(3):
        for dx in range(3):
            win = p[dy: dy + config.LAYOUT_H, dx: dx + config.LAYOUT_W]
            gx += SOBEL_X[dy, dx] * win
            gy += SOBEL_Y[dy, dx] * win
    mag = np.sqrt(gx * gx + gy * gy)
    mag /= max(float(mag.mean()), config.LAYOUT_MIN_MEAN)
    return mag.astype(np.float32).ravel()


def layout_score(a: np.ndarray, b: np.ndarray) -> float:
    """Mean per-tile cosine over the LAYOUT_GRID (4 cols × 5 rows of 14×16 px).

    Tiles with no edges (norm < LAYOUT_TILE_EPS): both empty → 1 (they agree), one empty → 0.
    """
    cols, rows = config.LAYOUT_GRID
    tw, th = config.LAYOUT_W // cols, config.LAYOUT_H // rows
    A = a.reshape(config.LAYOUT_H, config.LAYOUT_W).astype(np.float64)
    B = b.reshape(config.LAYOUT_H, config.LAYOUT_W).astype(np.float64)
    total = 0.0
    for r in range(rows):
        for c in range(cols):
            ta = A[r * th:(r + 1) * th, c * tw:(c + 1) * tw].ravel()
            tb = B[r * th:(r + 1) * th, c * tw:(c + 1) * tw].ravel()
            na, nb = float(np.linalg.norm(ta)), float(np.linalg.norm(tb))
            empty_a, empty_b = na < config.LAYOUT_TILE_EPS, nb < config.LAYOUT_TILE_EPS
            if empty_a or empty_b:
                total += 1.0 if (empty_a and empty_b) else 0.0
            else:
                total += float(ta @ tb) / (na * nb)
    return total / (rows * cols)


def model_input(path) -> np.ndarray:
    """Reference image → the exact 224×320 RGB uint8 the model sees (§4.5: bilinear stretch)."""
    with Image.open(path) as img:
        return np.asarray(img.convert("RGB").resize((config.INPUT_W, config.INPUT_H), Image.BILINEAR))


def lookalike_printings(cards: list[dict]) -> list[dict]:
    """Non-foil printings whose name spans >1 distinct picture."""
    by_name = defaultdict(list)
    for c in cards:
        if c["variant"] != "foil":
            by_name[c["name"]].append(c)
    return [c for group in by_name.values() if len({c["image_hash"] for c in group}) > 1 for c in group]


def main() -> None:
    cards = read_csv(config.CARDS_CSV)
    rows = lookalike_printings(cards)
    sigs = np.stack([signature(model_input(config.IMAGES_DIR / c["image_file"])) for c in rows]).astype("<f4")
    out = config.APP_DATA
    out.mkdir(parents=True, exist_ok=True)
    sigs.tofile(out / "layout.bin")
    (out / "layout_ids.json").write_text(json.dumps([c["printing_id"] for c in rows]), encoding="utf-8")
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta["layout"] = {"width": config.LAYOUT_W, "height": config.LAYOUT_H,
                      "gridCols": config.LAYOUT_GRID[0], "gridRows": config.LAYOUT_GRID[1], "printings": len(rows)}
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"layout.bin: {len(rows)} printings x {sigs.shape[1]} floats = {sigs.nbytes / 1e6:.1f}MB")


if __name__ == "__main__":
    main()

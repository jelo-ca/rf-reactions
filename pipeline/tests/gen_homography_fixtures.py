"""Write app/src/vision/__fixtures__/homography_parity.json: OpenCV homographies and a perspective
warp of a formula-defined image, so vitest can check app/src/vision/homography.ts (PLAN.md §5.7).

Run after changing the warp convention:  python tests/gen_homography_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

OUT = config.ROOT / "app" / "src" / "vision" / "__fixtures__" / "homography_parity.json"
SRC_W, SRC_H = 64, 48
OUT_W, OUT_H = 14, 20


def synth() -> np.ndarray:
    """Same formula as homography.test.ts `synth` (RGB, smooth + a checker so warps are visible)."""
    y, x = np.mgrid[0:SRC_H, 0:SRC_W]
    r = (x * 4) % 256
    g = (y * 5) % 256
    b = ((x // 8 + y // 8) % 2) * 200 + 20
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def main() -> None:
    quads = [
        [[10, 5], [40, 8], [42, 44], [8, 40]],
        [[30, 2], [60, 20], [36, 46], [5, 25]],   # rotated ~35°
        [[0, 0], [64, 0], [64, 48], [0, 48]],     # whole image
    ]
    cases = []
    rect = np.array([[0, 0], [OUT_W, 0], [OUT_W, OUT_H], [0, OUT_H]], np.float32)
    img = synth()
    for q in quads:
        quad = np.array(q, np.float32)
        h_out_to_src = cv2.getPerspectiveTransform(rect, quad)  # output pixel → source pixel
        m = cv2.getPerspectiveTransform(quad, rect)
        warped = cv2.warpPerspective(img, m, (OUT_W, OUT_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        cases.append({"quad": q, "H": [round(float(v), 9) for v in h_out_to_src.flatten()], "warped": warped.flatten().tolist()})
    data = {"srcW": SRC_W, "srcH": SRC_H, "outW": OUT_W, "outH": OUT_H, "cases": cases}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f}KB)")


if __name__ == "__main__":
    main()

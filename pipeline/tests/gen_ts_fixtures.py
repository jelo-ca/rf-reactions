"""Write app/src/vision/__fixtures__/layout_parity.json: Python-computed layout signatures and
scores for formula-defined images, so vitest can check the TS port against pipeline/layout.py.

Run after any change to layout.py:  python tests/gen_ts_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
from layout import layout_score, signature  # noqa: E402

OUT = config.ROOT / "app" / "src" / "vision" / "__fixtures__" / "layout_parity.json"


def synth(kind: int) -> np.ndarray:
    """Same formulas as app/src/vision/layout.test.ts `synth`."""
    y, x = np.mgrid[0:config.INPUT_H, 0:config.INPUT_W]
    if kind == 0:
        r, g, b = (x * x + 3 * y) % 256, (5 * x + y * y) % 256, ((x // 16 + y // 16) % 2) * 200
    elif kind == 1:  # "left-aligned text block"
        r = g = b = np.where((y >= 200) & (y < 260) & (x >= 16) & (x < 120), 230, 40)
    elif kind == 2:  # "centered text block"
        r = g = b = np.where((y >= 200) & (y < 260) & (x >= 60) & (x < 164), 230, 40)
    else:  # flat
        r = g = b = np.full_like(x, 128)
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def main() -> None:
    sigs = [signature(synth(k)) for k in range(4)]
    data = {
        "signatures": [[round(float(v), 6) for v in s] for s in sigs],
        "scores": {f"{i}-{j}": layout_score(sigs[i], sigs[j]) for i in range(4) for j in range(4) if i <= j},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f}KB)")


if __name__ == "__main__":
    main()

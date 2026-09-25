"""Browser parity fixtures (PLAN.md §4.8): 5 model-size PNGs + expected embeddings and layout signatures."""
from __future__ import annotations

import json

import numpy as np
from PIL import Image

import config
from augment import load_rgb, to_model_size
from cardsio import read_csv
from export_onnx import session, to_tensor
from layout import lookalike_printings, signature


def pick(cards: list[dict]) -> list[dict]:
    base = [c for c in cards if c["variant"] != "foil"]
    look = lookalike_printings(cards)
    chosen = look[:1] + [c for c in base[:: max(1, len(base) // config.PARITY_COUNT)] if c not in look[:1]]
    return chosen[: config.PARITY_COUNT]


def main() -> None:
    cards = read_csv(config.CARDS_CSV)
    sess = session()
    config.APP_PARITY.mkdir(parents=True, exist_ok=True)
    expected = []
    for c in pick(cards):
        rgb = to_model_size(load_rgb(config.IMAGES_DIR / c["image_file"]))
        fname = f"{c['printing_id']}.png"
        Image.fromarray(rgb).save(config.APP_PARITY / fname)
        # Re-read the saved PNG so expectations come from exactly what the browser will load.
        rgb = np.asarray(Image.open(config.APP_PARITY / fname).convert("RGB"))
        emb = sess.run(["embedding"], {"input": to_tensor(rgb)})[0][0]
        expected.append({"file": fname, "printingId": c["printing_id"],
                         "embedding": [float(v) for v in emb], "layout": [float(v) for v in signature(rgb)]})
    (config.APP_PARITY / "expected.json").write_text(json.dumps(expected), encoding="utf-8")
    print(f"parity fixtures: {[e['printingId'] for e in expected]}")


if __name__ == "__main__":
    main()

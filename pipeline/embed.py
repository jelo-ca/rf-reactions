"""Reference embeddings from the exact ONNX artifact the browser runs (PLAN.md §4.7).

One clean + REFERENCE_AUG_ROWS augmented rows per non-foil printing (foil rows share
the base image; the decision rule reaches them through cards.json + imageHash).

Writes app/public/data/embeddings.bin (<f4, [rows, dim], unit rows),
embedding_ids.json and meta.json (merged, keeps the "layout" block).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np

import config
from augment import augment, load_rgb, to_model_size
from cardsio import read_csv
from export_onnx import session, to_tensor


def reference_rows(card: dict) -> list[np.ndarray]:
    clean = load_rgb(config.IMAGES_DIR / card["image_file"])
    return [to_model_size(clean)] + [augment(clean, card["printing_id"], k) for k in range(config.REFERENCE_AUG_ROWS)]


def write_meta(**fields) -> None:
    path = config.APP_DATA / "meta.json"
    meta = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    meta.update(fields)
    path.write_text(json.dumps(meta, indent=1), encoding="utf-8")


def main() -> None:
    cards = [c for c in read_csv(config.CARDS_CSV) if c["variant"] != "foil"]
    sess = session()
    dim = sess.get_outputs()[0].shape[1]
    per = 1 + config.REFERENCE_AUG_ROWS
    emb = np.empty((len(cards) * per, dim), dtype="<f4")
    ids: list[str] = []
    t0 = time.time()
    for i, c in enumerate(cards):
        for k, rgb in enumerate(reference_rows(c)):
            emb[i * per + k] = sess.run(["embedding"], {"input": to_tensor(rgb)})[0][0]
            ids.append(c["printing_id"])
        if (i + 1) % 100 == 0:
            rate = (i + 1) / (time.time() - t0)
            print(f"  {i + 1}/{len(cards)} printings  ({rate:.1f}/s, ~{(len(cards) - i - 1) / rate / 60:.1f} min left)")

    norms = np.linalg.norm(emb, axis=1)
    if not np.allclose(norms, 1.0, atol=1e-4):
        raise SystemExit(f"rows not unit length: min {norms.min():.5f} max {norms.max():.5f}")
    config.APP_DATA.mkdir(parents=True, exist_ok=True)
    emb.tofile(config.APP_DATA / "embeddings.bin")
    (config.APP_DATA / "embedding_ids.json").write_text(json.dumps(ids), encoding="utf-8")
    write_meta(modelFile="/models/embedder.onnx", inputWidth=config.INPUT_W, inputHeight=config.INPUT_H,
               dim=int(dim), rows=len(ids), rowsPerPrinting=per, dtype="float32",
               builtAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    mb = emb.nbytes / 1e6
    print(f"embeddings.bin: {len(ids)} rows x {dim} = {mb:.1f}MB in {(time.time() - t0) / 60:.1f} min")
    if mb > config.EMBED_WARN_MB:
        print(f"WARN embeddings.bin {mb:.0f}MB > {config.EMBED_WARN_MB}MB: consider PCA (1280->256) or a smaller pool")


if __name__ == "__main__":
    main()

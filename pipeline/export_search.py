"""Bake the reference embeddings into the model as a final MatMul (PLAN.md §6.3 fallback).

recognizer.onnx = embedder.onnx + `scores = embedding @ E^T`, so the brute-force search runs
inside ONNX Runtime (WebGPU in the browser) instead of a JS loop. Outputs:
  embedding [1, dim]   — unchanged (parity page, capture tools)
  scores    [1, rows]  — cosine vs every reference row (rows are unit length)

Measured JS search in the browser worker was ~70–80 ms/query (budget p95 <= 20 ms).
Usage: python export_search.py   (after embed.py)
"""
from __future__ import annotations

import json

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper

import config

OUT = config.APP_PUBLIC / "models" / "recognizer.onnx"


def build(embedder_path=config.APP_MODEL, out_path=OUT) -> tuple[int, int]:
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4").reshape(meta["rows"], meta["dim"])
    model = onnx.load(str(embedder_path))
    g = model.graph
    g.initializer.append(numpy_helper.from_array(np.ascontiguousarray(emb.T), name="reference_embeddings"))
    g.node.append(helper.make_node("MatMul", ["embedding", "reference_embeddings"], ["scores"], name="search"))
    g.output.append(helper.make_tensor_value_info("scores", onnx.TensorProto.FLOAT, [1, meta["rows"]]))
    onnx.checker.check_model(model)
    onnx.save(model, str(out_path))
    return meta["rows"], meta["dim"]


def verify(out_path=OUT) -> float:
    """scores must equal embedding @ E^T computed in numpy."""
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4").reshape(meta["rows"], meta["dim"])
    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    x = np.random.default_rng(config.SEED).random((1, 3, config.INPUT_H, config.INPUT_W), dtype=np.float32)
    e, s = sess.run(["embedding", "scores"], {"input": x})
    return float(np.abs(s[0] - emb @ e[0]).max())


def main() -> None:
    rows, dim = build()
    err = verify()
    print(f"recognizer.onnx: {OUT.stat().st_size / 1e6:.1f}MB, scores [1,{rows}] from dim {dim}, max |err| {err:.2e}")
    if err > 1e-4:
        raise SystemExit("baked search does not match numpy")
    meta_path = config.APP_DATA / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["recognizerFile"] = "/models/recognizer.onnx"
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

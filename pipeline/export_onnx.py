"""Embedder → app/public/models/embedder.onnx, verified against PyTorch (PLAN.md §4.6).

fp32, static input [1,3,320,224] named "input", output "embedding".
"""
from __future__ import annotations

import numpy as np
import onnxruntime as ort
import torch

import config
from augment import load_rgb, to_model_size
from cardsio import read_csv
from model import load_embedder


def to_tensor(rgb: np.ndarray) -> np.ndarray:
    """uint8 [320,224,3] → float32 [1,3,320,224] in [0,1] (what the browser builds)."""
    return (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]


def session(path=None) -> ort.InferenceSession:
    return ort.InferenceSession(str(path or config.APP_MODEL), providers=["CPUExecutionProvider"])


def export(model: torch.nn.Module) -> None:
    config.APP_MODEL.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 3, config.INPUT_H, config.INPUT_W)
    torch.onnx.export(model, (dummy,), str(config.APP_MODEL), input_names=["input"], output_names=["embedding"],
                      opset_version=config.ONNX_OPSET, external_data=False)


def verify(model: torch.nn.Module, n: int = 5) -> float:
    cards = [c for c in read_csv(config.CARDS_CSV) if c["variant"] != "foil"][:: 97][:n]
    sess = session()
    worst = 1.0
    for c in cards:
        x = to_tensor(to_model_size(load_rgb(config.IMAGES_DIR / c["image_file"])))
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()[0]
        got = sess.run(["embedding"], {"input": x})[0][0]
        cos = float(ref @ got / (np.linalg.norm(ref) * np.linalg.norm(got)))
        worst = min(worst, cos)
        print(f"  {c['printing_id']}: cos {cos:.6f}  |onnx|={np.linalg.norm(got):.4f}")
    return worst


def main() -> None:
    model = load_embedder()
    export(model)
    size = config.APP_MODEL.stat().st_size / 1e6
    worst = verify(model)
    print(f"embedder.onnx: {size:.1f}MB, worst ONNX-vs-PyTorch cosine {worst:.6f}")
    if worst < config.ONNX_PARITY_MIN_COS:
        raise SystemExit(f"ONNX parity failed: {worst:.6f} < {config.ONNX_PARITY_MIN_COS}")


if __name__ == "__main__":
    main()

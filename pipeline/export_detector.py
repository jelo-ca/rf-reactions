"""Card detector → app/public/models/detector.onnx, verified against PyTorch (PLAN.md §5.7).

fp32, static input "frame" [1,3,DETECT_H,DETECT_W] in [0,1]; outputs "present" [1] (logit) and
"corners" [1,4,2] (x, y in 0–1; TL, TR, BR, BL). Parity on fixed synthetic frames.
"""
from __future__ import annotations

import numpy as np
import onnxruntime as ort
import torch

import config
from detect_model import load_detector
from detect_synth import default_source

PARITY_FRAMES = 8
MAX_CORNER_DIFF = 1e-3   # 0–1 units (≈ 0.4 px at 384 wide)
MAX_LOGIT_DIFF = 1e-3


def export(model: torch.nn.Module) -> None:
    config.APP_DETECTOR.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 3, config.DETECT_H, config.DETECT_W)
    torch.onnx.export(model, (dummy,), str(config.APP_DETECTOR), input_names=["frame"],
                      output_names=["present", "corners"], opset_version=config.ONNX_OPSET, external_data=False)


def verify(model: torch.nn.Module) -> tuple[float, float]:
    sess = ort.InferenceSession(str(config.APP_DETECTOR), providers=["CPUExecutionProvider"])
    src = default_source()
    worst_c = worst_p = 0.0
    for i in range(PARITY_FRAMES):
        s = src.synthetic(np.random.default_rng([4242, i]))
        x = (s.image.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        with torch.no_grad():
            p_ref, c_ref = (t.numpy() for t in model(torch.from_numpy(x)))
        p_got, c_got = sess.run(["present", "corners"], {"frame": x})
        worst_c = max(worst_c, float(np.abs(c_ref - c_got).max()))
        worst_p = max(worst_p, float(np.abs(p_ref - p_got).max()))
    return worst_c, worst_p


def main() -> None:
    model = load_detector()
    export(model)
    size = config.APP_DETECTOR.stat().st_size / 1e6
    dc, dp = verify(model)
    print(f"detector.onnx: {size:.1f}MB, worst ONNX-vs-PyTorch corner diff {dc:.2e}, logit diff {dp:.2e}")
    if dc > MAX_CORNER_DIFF or dp > MAX_LOGIT_DIFF:
        raise SystemExit(f"ONNX parity failed (corners {dc:.2e} > {MAX_CORNER_DIFF} or logit {dp:.2e} > {MAX_LOGIT_DIFF})")


if __name__ == "__main__":
    main()

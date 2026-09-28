import numpy as np
import torch

import config
from detect_model import CardDetector, detector_loss, gaussian_targets, soft_argmax
from detect_synth import DetectSource, card_quad, zoom_shift


def test_soft_argmax_finds_peak():
    heat = torch.full((1, 4, 28, 48), -20.0)
    cells = [(3, 5), (40, 2), (47, 27), (0, 27)]
    for k, (x, y) in enumerate(cells):
        heat[0, k, y, x] = 20.0
    got = soft_argmax(heat)[0]
    want = torch.tensor([[(x + 0.5) / 48, (y + 0.5) / 28] for x, y in cells])
    assert torch.allclose(got, want, atol=1e-4)


def test_gaussian_targets_centre_and_sum():
    c = torch.tensor([[[0.25, 0.5], [0.75, 0.5], [0.75, 0.9], [0.25, 0.9]]])
    g = gaussian_targets(c, 28, 48, 1.0)
    assert torch.allclose(g.flatten(2).sum(-1), torch.ones(1, 4))
    assert torch.allclose(soft_argmax(g.clamp_min(1e-12).log()), c, atol=0.02)


def test_detector_shapes_and_loss_backprop():
    torch.manual_seed(0)
    model = CardDetector(pretrained=False)
    x = torch.rand(2, 3, config.DETECT_H, config.DETECT_W)
    present, corners = model.eval()(x)
    assert present.shape == (2,) and corners.shape == (2, 4, 2)
    assert ((corners >= 0) & (corners <= 1)).all()
    model.train()
    gt = torch.tensor([[[0.2, 0.2], [0.4, 0.2], [0.4, 0.6], [0.2, 0.6]], [[0, 0], [0, 0], [0, 0], [0, 0]]])
    loss, parts = detector_loss(model, x, gt, torch.tensor([1.0, 0.0]))
    loss.backward()
    assert torch.isfinite(loss) and parts["l1"] > 0
    assert any(p.grad is not None and p.grad.abs().sum() > 0 for p in model.heat.parameters())


def test_card_quad_inside_and_clockwise():
    rng = np.random.default_rng(1)
    for _ in range(200):
        q = card_quad(rng, 768, 432)
        assert q is not None
        assert (q >= 0).all() and (q[:, 0] <= 768).all() and (q[:, 1] <= 432).all()
        area2 = sum(q[i, 0] * q[(i + 1) % 4, 1] - q[(i + 1) % 4, 0] * q[i, 1] for i in range(4))
        assert area2 > 0  # TL, TR, BR, BL clockwise on screen


def test_zoom_shift_keeps_corners_consistent():
    rng = np.random.default_rng(2)
    img = np.zeros((100, 200, 3), np.uint8)
    img[40:60, 50:70] = 255  # a white square at known corners
    corners = np.array([[50, 40], [70, 40], [70, 60], [50, 60]], np.float32) / np.array([200, 100], np.float32)
    out, moved = zoom_shift(img, corners, rng)
    px = moved * np.array([200, 100])
    cx, cy = px.mean(0)
    assert out[int(cy), int(cx)].mean() > 200  # the square moved with its corners


def test_samples_are_deterministic_and_valid(tmp_path):
    from PIL import Image
    card = tmp_path / "c.jpg"
    Image.new("RGB", (372, 520), (200, 30, 30)).save(card)
    src = DetectSource([card], [], [])
    a, b = src.sample(0, 5), src.sample(0, 5)
    assert np.array_equal(a.image, b.image) and np.array_equal(a.corners, b.corners)
    assert a.image.shape == (config.DETECT_H, config.DETECT_W, 3) and a.image.dtype == np.uint8
    seen = {src.sample(0, i).present for i in range(40)}
    assert seen == {0.0, 1.0}

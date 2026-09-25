import numpy as np
import pytest

import config
from layout import layout_score, lookalike_printings, signature

H, W = config.INPUT_H, config.INPUT_W


def img(fill=0):
    return np.full((H, W, 3), fill, dtype=np.uint8)


def text_block(x0, x1, y0=200, y1=260):
    a = img(40)
    a[y0:y1, x0:x1] = 230
    return a


def test_signature_shape_and_normalized_mean():
    rng = np.random.default_rng(0)
    s = signature(rng.integers(0, 256, (H, W, 3), dtype=np.uint8))
    assert s.shape == (config.LAYOUT_H * config.LAYOUT_W,) and s.dtype == np.float32
    assert s.mean() == pytest.approx(1.0, rel=1e-4)


def test_signature_flat_image_is_zero():
    assert np.abs(signature(img(128))).max() < 1e-6


def test_signature_ignores_brightness_and_contrast():
    a = text_block(20, 100)
    b = (a.astype(np.float32) * 0.5 + 30).astype(np.uint8)  # darker, lower contrast
    assert layout_score(signature(a), signature(b)) > 0.99


def test_signature_box_average_is_exact():
    # A 4×4-aligned block edge gives the same result as the hand-computed downsample.
    a = img(0)
    a[:, 112:] = 255
    s = signature(a).reshape(config.LAYOUT_H, config.LAYOUT_W)
    col = s[40]
    assert np.argmax(col) in (27, 28) and col[:26].max() < 1e-9 and col[30:].max() < 1e-9


def test_layout_score_separates_left_vs_centered_text():
    left, left2, centered = text_block(16, 120), text_block(18, 122), text_block(60, 164)
    same = layout_score(signature(left), signature(left2))
    diff = layout_score(signature(left), signature(centered))
    assert same > diff + 0.1


def test_layout_score_identity_and_symmetry():
    a, b = signature(text_block(16, 120)), signature(text_block(60, 164))
    assert layout_score(a, a) == pytest.approx(1.0)
    assert layout_score(a, b) == pytest.approx(layout_score(b, a))


def test_signature_rejects_wrong_size():
    with pytest.raises(ValueError):
        signature(np.zeros((224, 320, 3), np.uint8))


def test_lookalike_printings_only_multi_picture_names_no_foils():
    cards = [
        {"printing_id": "A-1", "name": "A", "image_hash": "h1", "variant": "normal"},
        {"printing_id": "A-1F", "name": "A", "image_hash": "h1", "variant": "foil"},
        {"printing_id": "A-1A", "name": "A", "image_hash": "h2", "variant": "alt_art"},
        {"printing_id": "B-1", "name": "B", "image_hash": "h3", "variant": "normal"},
        {"printing_id": "B-P", "name": "B", "image_hash": "h3", "variant": "promo"},
    ]
    assert [c["printing_id"] for c in lookalike_printings(cards)] == ["A-1", "A-1A"]


def test_layout_score_empty_tiles_agree():
    a = signature(text_block(16, 120))
    b = signature(text_block(16, 120) // 2 + 20)  # same layout, different exposure; empty tiles stay empty
    assert layout_score(a, b) > 0.99
    blank = np.zeros_like(a)
    assert layout_score(a, blank) < 0.9  # tiles with text vs nothing disagree

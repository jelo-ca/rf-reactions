import json

import numpy as np
import pytest

import config
from augment import augment, seed_for, to_model_size


@pytest.fixture(scope="module")
def clean():
    rng = np.random.default_rng(1)
    img = rng.integers(0, 256, (1039 // 8, 744 // 8, 3), dtype=np.uint8)
    return np.kron(img, np.ones((8, 8, 1), dtype=np.uint8))  # blocky "card" 744x1039-ish


def test_augment_shape_and_dtype(clean):
    out = augment(clean, "OGN-001", 0)
    assert out.shape == (config.INPUT_H, config.INPUT_W, 3) and out.dtype == np.uint8


def test_augment_is_deterministic(clean):
    assert np.array_equal(augment(clean, "OGN-001", 3), augment(clean, "OGN-001", 3))


def test_augment_varies_by_index_and_printing(clean):
    a, b, c = augment(clean, "OGN-001", 0), augment(clean, "OGN-001", 1), augment(clean, "OGN-002", 0)
    assert not np.array_equal(a, b) and not np.array_equal(a, c)


def test_augment_differs_from_clean_but_stays_close(clean):
    ref = to_model_size(clean).astype(np.float32)
    diff = np.abs(augment(clean, "OGN-001", 0).astype(np.float32) - ref).mean()
    assert 1 < diff < 80  # changed, but still the same card-ish image


def test_seed_depends_on_global_seed(monkeypatch):
    s = seed_for("OGN-001", 0)
    monkeypatch.setattr(config, "SEED", config.SEED + 1)
    assert seed_for("OGN-001", 0) != s


def test_to_model_size_is_exact_stretch():
    out = to_model_size(np.zeros((1039, 744, 3), np.uint8))
    assert out.shape == (config.INPUT_H, config.INPUT_W, 3)


def test_to_tensor_layout():
    pytest.importorskip("onnxruntime")
    from export_onnx import to_tensor
    rgb = np.zeros((config.INPUT_H, config.INPUT_W, 3), np.uint8)
    rgb[..., 0] = 255
    t = to_tensor(rgb)
    assert t.shape == (1, 3, config.INPUT_H, config.INPUT_W) and t.dtype == np.float32
    assert t[0, 0].min() == 1.0 and t[0, 1:].max() == 0.0  # planar RGB in [0,1]


def test_write_meta_merges(tmp_path, monkeypatch):
    from embed import write_meta
    monkeypatch.setattr(config, "APP_DATA", tmp_path)
    (tmp_path / "meta.json").write_text(json.dumps({"layout": {"printings": 3}}))
    write_meta(dim=1280, rows=9)
    assert json.loads((tmp_path / "meta.json").read_text()) == {"layout": {"printings": 3}, "dim": 1280, "rows": 9}


APP_DATA_READY = (config.APP_DATA / "embeddings.bin").exists() and (config.APP_DATA / "meta.json").exists()


@pytest.mark.skipif(not APP_DATA_READY, reason="run scripts/build_data.sh first")
def test_built_embeddings_contract():
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    ids = json.loads((config.APP_DATA / "embedding_ids.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4")
    assert len(ids) == meta["rows"] and emb.size == meta["rows"] * meta["dim"]
    norms = np.linalg.norm(emb.reshape(meta["rows"], meta["dim"]), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-4)
    per = meta["rowsPerPrinting"]
    assert all(len(set(ids[i:i + per])) == 1 for i in range(0, len(ids), per))

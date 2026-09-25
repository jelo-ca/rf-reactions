"""Synthetic camera variants of a clean card image (PLAN.md §4.4).

Simulates a webcam shot of a card held in the guide box: framing jitter,
perspective, small rotation, lighting/colour shifts, blur, sensor noise,
glare and JPEG. Deterministic per (printing_id, index) via config.SEED.

Augmentation runs at 2× model resolution and is then resized to 224×320 with
the same bilinear stretch as clean images (§4.5).

Usage: python augment.py   → pipeline/out/aug_preview.png (contact sheet for the human)
"""
from __future__ import annotations

import hashlib

import albumentations as A
import cv2
import numpy as np
from PIL import Image

import config

WORK_W, WORK_H = config.INPUT_W * 2, config.INPUT_H * 2


def seed_for(printing_id: str, index: int) -> int:
    h = hashlib.sha256(f"{config.SEED}:{printing_id}:{index}".encode()).digest()
    return int.from_bytes(h[:4], "little")


def frame_jitter(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Move each edge in/out by up to AUG_FRAME_JITTER; exposed border gets a random flat 'background'."""
    h, w = img.shape[:2]
    j = config.AUG_FRAME_JITTER
    l, r = (rng.uniform(-j, j, 2) * w).astype(int)
    t, b = (rng.uniform(-j, j, 2) * h).astype(int)
    bg = rng.integers(0, 256, 3).tolist()
    padded = cv2.copyMakeBorder(img, max(t, 0), max(b, 0), max(l, 0), max(r, 0), cv2.BORDER_CONSTANT, value=bg)
    ph, pw = padded.shape[:2]
    y0, x0 = max(-t, 0), max(-l, 0)
    crop = padded[y0: ph - max(-b, 0), x0: pw - max(-r, 0)]
    return cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)


def color_temperature(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Warm/cool white balance shift: scale R and B in opposite directions."""
    t = rng.uniform(-config.AUG_TEMP_SHIFT, config.AUG_TEMP_SHIFT)
    gains = np.array([1 + t, 1.0, 1 - t], dtype=np.float32)
    return np.clip(img.astype(np.float32) * gains, 0, 255).astype(np.uint8)


def glare(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Soft white elliptical highlight at a random spot, opacity AUG_GLARE_OPACITY."""
    h, w = img.shape[:2]
    cx, cy = rng.uniform(0, w), rng.uniform(0, h)
    ax, ay = rng.uniform(0.15, 0.45) * w, rng.uniform(0.05, 0.25) * h
    ang = rng.uniform(0, np.pi)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    u = (dx * np.cos(ang) + dy * np.sin(ang)) / ax
    v = (-dx * np.sin(ang) + dy * np.cos(ang)) / ay
    mask = np.exp(-(u * u + v * v) * 2.0)[..., None]
    alpha = rng.uniform(*config.AUG_GLARE_OPACITY) * mask
    out = img.astype(np.float32) * (1 - alpha) + 255.0 * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def pipeline(seed: int) -> A.Compose:
    return A.Compose([
        A.Perspective(scale=config.AUG_PERSPECTIVE, keep_size=True, border_mode=cv2.BORDER_REPLICATE, p=0.9),
        A.Rotate(limit=config.AUG_ROTATE_DEG, border_mode=cv2.BORDER_REPLICATE, p=0.9),
        A.RandomBrightnessContrast(brightness_limit=0.25, contrast_limit=0.25, p=0.9),
        A.OneOf([A.GaussianBlur(blur_limit=(3, 5)), A.MotionBlur(blur_limit=(3, 7))], p=0.6),
        A.OneOf([A.ISONoise(), A.GaussNoise(std_range=(0.02, 0.06))], p=0.7),
    ], seed=seed)


def augment(clean: np.ndarray, printing_id: str, index: int) -> np.ndarray:
    """clean: uint8 RGB, any size → uint8 RGB [320, 224, 3]."""
    seed = seed_for(printing_id, index)
    rng = np.random.default_rng(seed)
    img = cv2.resize(clean, (WORK_W, WORK_H), interpolation=cv2.INTER_AREA)
    img = frame_jitter(img, rng)
    img = pipeline(seed)(image=img)["image"]
    img = color_temperature(img, rng)
    if rng.random() < config.AUG_GLARE_P:
        img = glare(img, rng)
    q = int(rng.integers(*config.AUG_JPEG_QUALITY))
    ok, buf = cv2.imencode(".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, q])
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)[..., ::-1]
    return to_model_size(img)


def to_model_size(rgb: np.ndarray) -> np.ndarray:
    """§4.5: bilinear stretch to exactly 224×320 (PIL, same as clean references)."""
    return np.asarray(Image.fromarray(np.ascontiguousarray(rgb)).resize((config.INPUT_W, config.INPUT_H), Image.BILINEAR))


def load_rgb(path) -> np.ndarray:
    with Image.open(path) as img:
        return np.asarray(img.convert("RGB"))


def preview(n_cards: int = 6) -> None:
    from cardsio import read_csv
    cards = [c for c in read_csv(config.CARDS_CSV) if c["variant"] != "foil"]
    rng = np.random.default_rng(config.SEED)
    picks = [cards[i] for i in rng.choice(len(cards), n_cards, replace=False)]
    cols = 1 + config.AUG_PER_IMAGE
    sheet = Image.new("RGB", (cols * config.INPUT_W, n_cards * config.INPUT_H), "white")
    for r, c in enumerate(picks):
        clean = load_rgb(config.IMAGES_DIR / c["image_file"])
        tiles = [to_model_size(clean)] + [augment(clean, c["printing_id"], k) for k in range(config.AUG_PER_IMAGE)]
        for k, t in enumerate(tiles):
            sheet.paste(Image.fromarray(t), (k * config.INPUT_W, r * config.INPUT_H))
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = config.OUT_DIR / "aug_preview.png"
    sheet.save(out)
    print(f"wrote {out} ({n_cards} cards: clean + {config.AUG_PER_IMAGE} augmentations each)")


if __name__ == "__main__":
    preview()

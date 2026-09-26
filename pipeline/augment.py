"""Synthetic camera variants of a clean card image (PLAN.md §4.4) — v2, matched to real eval photos.

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


def background(rng: np.random.Generator) -> np.ndarray:
    """Photo-like backdrop behind the card: smooth two-colour gradient (room / window light) + soft blobs."""
    h, w = WORK_H, WORK_W
    # Muted, room-like colours: a grey level plus a small tint (walls, skin, window light).
    c1 = rng.uniform(30, 245) + rng.uniform(-35, 35, 3)
    c2 = rng.uniform(30, 245) + rng.uniform(-35, 35, 3)
    ang = rng.uniform(0, 2 * np.pi)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = ((xx / w - 0.5) * np.cos(ang) + (yy / h - 0.5) * np.sin(ang) + 0.5).clip(0, 1)[..., None]
    img = c1 * (1 - t) + c2 * t
    blobs = cv2.GaussianBlur(rng.uniform(-40, 40, (h // 16, w // 16, 3)).astype(np.float32), (0, 0), 1.5)
    img += cv2.resize(blobs, (w, h), interpolation=cv2.INTER_CUBIC)
    return np.clip(img, 0, 255).astype(np.uint8)


def place_card(card: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Warp the card into the guide-box crop: scale, offset, rotation and perspective, over a backdrop.

    Real crops (eval photos): the card fills ~65–100% of the box height, off-centre and tilted.
    Returns (image, card mask) at WORK size.
    """
    h, w = WORK_H, WORK_W
    s = rng.uniform(*config.AUG_CARD_SCALE)
    cw, ch = w * s, h * s
    cx = w / 2 + rng.uniform(-1, 1) * (w - cw) / 2 + rng.uniform(-0.04, 0.04) * w
    cy = h / 2 + rng.uniform(-1, 1) * (h - ch) / 2 + rng.uniform(-0.04, 0.04) * h
    a = np.deg2rad(rng.uniform(-config.AUG_ROTATE_DEG, config.AUG_ROTATE_DEG))
    corners = np.array([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]], np.float32)
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]], np.float32)
    dst = corners @ rot.T + [cx, cy]
    dst += rng.uniform(-1, 1, (4, 2)).astype(np.float32) * config.AUG_PERSPECTIVE[1] * np.array([w, h], np.float32)
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    m = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    warped = cv2.warpPerspective(card, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), m, (w, h), flags=cv2.INTER_LINEAR)
    alpha = (mask.astype(np.float32) / 255.0)[..., None]
    out = warped.astype(np.float32) * alpha + background(rng).astype(np.float32) * (1 - alpha)
    return out.astype(np.uint8), mask


def hand(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Skin-toned thumb/fingers over a card edge (the card is held by hand)."""
    h, w = img.shape[:2]
    out = img.copy()
    tone = np.array([rng.uniform(150, 235), rng.uniform(100, 185), rng.uniform(80, 160)]) * rng.uniform(0.6, 1.0)
    for _ in range(int(rng.integers(1, 3))):
        side = rng.integers(0, 3)  # left, right, bottom
        if side == 0:
            c = (int(rng.uniform(-0.05, 0.12) * w), int(rng.uniform(0.35, 0.95) * h))
        elif side == 1:
            c = (int(rng.uniform(0.88, 1.05) * w), int(rng.uniform(0.35, 0.95) * h))
        else:
            c = (int(rng.uniform(0.1, 0.9) * w), int(rng.uniform(0.9, 1.05) * h))
        axes = (int(rng.uniform(0.06, 0.14) * w), int(rng.uniform(0.08, 0.16) * h))
        cv2.ellipse(out, c, axes, float(rng.uniform(0, 180)), 0, 360, tone.tolist(), -1, cv2.LINE_AA)
    return cv2.GaussianBlur(out, (0, 0), 1.0) if rng.random() < 0.5 else out


def lighting(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Webcam lighting: exposure/gamma (backlight), colour cast, hazy veil, contrast loss."""
    x = img.astype(np.float32) / 255.0
    x = x ** rng.uniform(*config.AUG_GAMMA)                        # >1 darkens (backlit subject)
    x *= rng.uniform(*config.AUG_EXPOSURE)
    x *= rng.uniform(*config.AUG_CAST, 3).astype(np.float32)       # per-channel gain: colour cast
    if rng.random() < config.AUG_VEIL_P:                           # haze from sleeve / screen reflection
        veil = rng.uniform(0.5, 1.0, 3).astype(np.float32) * np.array([0.9, 0.9, 1.0], np.float32)
        k = rng.uniform(*config.AUG_VEIL)
        x = x * (1 - k) + veil * k
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)


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
        A.OneOf([A.GaussianBlur(blur_limit=(3, 7)), A.MotionBlur(blur_limit=(3, 9))], p=0.7),
        A.OneOf([A.ISONoise(intensity=(0.1, 0.5)), A.GaussNoise(std_range=(0.02, 0.08))], p=0.8),
    ], seed=seed)


def augment(clean: np.ndarray, printing_id: str, index: int) -> np.ndarray:
    """clean: uint8 RGB, any size → uint8 RGB [320, 224, 3] that looks like a guide-box webcam crop."""
    seed = seed_for(printing_id, index)
    rng = np.random.default_rng(seed)
    card = cv2.resize(clean, (WORK_W, WORK_H), interpolation=cv2.INTER_AREA)
    img, _ = place_card(card, rng)
    if rng.random() < config.AUG_HAND_P:
        img = hand(img, rng)
    img = lighting(img, rng)
    if rng.random() < config.AUG_GLARE_P:
        img = glare(img, rng)
    img = pipeline(seed)(image=img)["image"]
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

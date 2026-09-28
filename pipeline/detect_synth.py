"""Training frames for the card detector (PLAN.md §5.7): synthetic composites + real labelled frames.

Synthetic: a random reference card warped (scale, rotation, perspective) onto a background — the
human's empty webcam frames when there are any, else procedural rooms — with fingers on its edges,
non-card distractors, webcam lighting (augment.lighting), glare, blur, noise and JPEG. ~20% of
frames have no card. Real: the human's labelled frames with mild photometric jitter and zoom/shift.

Every sample: image uint8 [DETECT_H, DETECT_W, 3] RGB, corners float32 [4, 2] in 0–1 (TL, TR, BR, BL),
present 0/1. Deterministic per (seed, index).

Usage: python detect_synth.py  → pipeline/out/detect_preview.png (contact sheet for the human)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

import config
from augment import glare, lighting, load_rgb
from detect_data import RealFrame

OUT_W, OUT_H = config.DETECT_W, config.DETECT_H


@dataclass
class Sample:
    image: np.ndarray       # uint8 [H, W, 3]
    corners: np.ndarray     # float32 [4, 2], 0–1; zeros when absent
    present: float


# ---- backgrounds ----

def procedural_background(rng: np.random.Generator, w: int, h: int) -> np.ndarray:
    """Room-like backdrop: two-tone gradient, soft blobs, a blurry person, furniture edges."""
    c1 = rng.uniform(20, 235) + rng.uniform(-40, 40, 3)
    c2 = rng.uniform(20, 235) + rng.uniform(-40, 40, 3)
    ang = rng.uniform(0, 2 * np.pi)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = ((xx / w - 0.5) * np.cos(ang) + (yy / h - 0.5) * np.sin(ang) + 0.5).clip(0, 1)[..., None]
    img = c1 * (1 - t) + c2 * t
    blobs = cv2.GaussianBlur(rng.uniform(-45, 45, (max(h // 24, 2), max(w // 24, 2), 3)).astype(np.float32), (0, 0), 1.2)
    img = img + cv2.resize(blobs, (w, h), interpolation=cv2.INTER_CUBIC)
    img = np.clip(img, 0, 255).astype(np.uint8)
    for _ in range(int(rng.integers(0, 5))):  # furniture / shelves / door frames: straight edges
        col = (rng.uniform(15, 240) + rng.uniform(-30, 30, 3)).clip(0, 255).tolist()
        x0, y0 = int(rng.uniform(-0.2, 1) * w), int(rng.uniform(-0.2, 1) * h)
        cv2.rectangle(img, (x0, y0), (x0 + int(rng.uniform(0.1, 0.8) * w), y0 + int(rng.uniform(0.1, 0.8) * h)), col, -1)
    if rng.random() < 0.6:  # the person holding the card: head + shoulders, out of focus
        tone = (np.array([rng.uniform(150, 235), rng.uniform(100, 185), rng.uniform(80, 160)]) * rng.uniform(0.35, 1.0)).tolist()
        cx, cy = int(rng.uniform(0.25, 0.75) * w), int(rng.uniform(0.25, 0.6) * h)
        cv2.ellipse(img, (cx, cy), (int(0.12 * w), int(0.22 * h)), 0, 0, 360, tone, -1, cv2.LINE_AA)
        shirt = (rng.uniform(10, 230) + rng.uniform(-30, 30, 3)).clip(0, 255).tolist()
        cv2.ellipse(img, (cx, h + int(0.1 * h)), (int(0.35 * w), int(0.4 * h)), 0, 180, 360, shirt, -1, cv2.LINE_AA)
    return cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 3.0))


def real_background(frame: np.ndarray, rng: np.random.Generator, w: int, h: int) -> np.ndarray:
    """An empty webcam frame, randomly zoomed/shifted a little."""
    fh, fw = frame.shape[:2]
    s = rng.uniform(0.75, 1.0)
    cw, ch = int(fw * s), int(fh * s)
    x0, y0 = int(rng.integers(0, fw - cw + 1)), int(rng.integers(0, fh - ch + 1))
    return cv2.resize(frame[y0:y0 + ch, x0:x0 + cw], (w, h), interpolation=cv2.INTER_AREA)


# ---- card placement ----

def card_quad(rng: np.random.Generator, w: int, h: int) -> np.ndarray | None:
    """Destination corners (TL, TR, BR, BL) fully inside a w×h frame, or None if no fit was found."""
    for attempt in range(12):
        ch = rng.uniform(*config.DETECT_CARD_H) * h * (0.85 ** attempt)
        cw = ch * config.DETECT_CARD_ASPECT
        base = np.array([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]], np.float32)
        th = math.radians(rng.uniform(-config.DETECT_ROTATE_DEG, config.DETECT_ROTATE_DEG))
        rot = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]], np.float32)
        quad = base @ rot.T + rng.uniform(-config.DETECT_PERSPECTIVE, config.DETECT_PERSPECTIVE, (4, 2)).astype(np.float32) * ch
        lo, hi = quad.min(0), quad.max(0)
        if hi[0] - lo[0] > w - 4 or hi[1] - lo[1] > h - 4:
            continue
        cx = rng.uniform(2 - lo[0], w - 2 - hi[0])
        cy = rng.uniform(2 - lo[1], h - 2 - hi[1])
        return quad + np.array([cx, cy], np.float32)
    return None


def rounded_mask(w: int, h: int, r: int) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    cv2.rectangle(m, (r, 0), (w - 1 - r, h - 1), 255, -1)
    cv2.rectangle(m, (0, r), (w - 1, h - 1 - r), 255, -1)
    for cx, cy in ((r, r), (w - 1 - r, r), (w - 1 - r, h - 1 - r), (r, h - 1 - r)):
        cv2.circle(m, (cx, cy), r, 255, -1, cv2.LINE_AA)
    return m


def paste_card(bg: np.ndarray, card: np.ndarray, quad: np.ndarray) -> np.ndarray:
    ch, cw = card.shape[:2]
    src = np.array([[0, 0], [cw, 0], [cw, ch], [0, ch]], np.float32)
    m = cv2.getPerspectiveTransform(src, quad.astype(np.float32))
    h, w = bg.shape[:2]
    warped = cv2.warpPerspective(card, m, (w, h), flags=cv2.INTER_LINEAR)
    alpha = cv2.warpPerspective(rounded_mask(cw, ch, max(2, int(cw * 0.035))), m, (w, h), flags=cv2.INTER_LINEAR)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    return (bg * (1 - a) + warped * a).astype(np.uint8)


def fingers(img: np.ndarray, quad: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Skin-toned fingertips/thumb over the card's left, right or bottom edge, plus sometimes a palm."""
    tone = (np.array([rng.uniform(150, 235), rng.uniform(100, 185), rng.uniform(80, 160)]) * rng.uniform(0.5, 1.0)).tolist()
    ch = np.linalg.norm(quad[3] - quad[0])
    edges = [(quad[3], quad[0]), (quad[1], quad[2]), (quad[2], quad[3])]  # left, right, bottom
    for _ in range(int(rng.integers(1, 4))):
        a, b = edges[int(rng.integers(0, 3))]
        p = a + (b - a) * rng.uniform(0.15, 0.85)
        axes = (int(ch * rng.uniform(0.05, 0.1)), int(ch * rng.uniform(0.08, 0.16)))
        ang = math.degrees(math.atan2(*(b - a)[::-1]))
        cv2.ellipse(img, (int(p[0]), int(p[1])), axes, ang + 90, 0, 360, tone, -1, cv2.LINE_AA)
    if rng.random() < 0.4:  # palm/wrist below the card
        c = (quad[2] + quad[3]) / 2
        cv2.ellipse(img, (int(c[0]), int(c[1] + ch * 0.35)), (int(ch * 0.3), int(ch * 0.35)), 0, 0, 360, tone, -1, cv2.LINE_AA)
    return img


def distractors(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Non-card things: phone/book-like rectangles and posters, so 'rectangle' alone isn't enough."""
    h, w = img.shape[:2]
    for _ in range(int(rng.integers(1, 3))):
        rw, rh = rng.uniform(0.08, 0.4) * w, rng.uniform(0.1, 0.6) * h
        c = (rng.uniform(0, w), rng.uniform(0, h))
        box = cv2.boxPoints((c, (rw, rh), rng.uniform(0, 180))).astype(np.int32)
        col = (rng.uniform(0, 255, 3)).tolist()
        cv2.fillPoly(img, [box], col, cv2.LINE_AA)
        if rng.random() < 0.5:  # a screen/poster with some texture
            inner = cv2.boxPoints((c, (rw * 0.85, rh * 0.85), 0)).astype(np.int32)
            cv2.polylines(img, [inner], True, (rng.uniform(0, 255, 3)).tolist(), 2, cv2.LINE_AA)
    return img


def camera(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Webcam look: lighting/cast/haze, glare, blur, sensor noise, JPEG."""
    img = lighting(img, rng)
    if rng.random() < config.AUG_GLARE_P:
        img = glare(img, rng)
    if rng.random() < 0.6:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, 1.6))
    if rng.random() < 0.7:
        img = np.clip(img + rng.normal(0, rng.uniform(2, 9), img.shape), 0, 255).astype(np.uint8)
    q = int(rng.integers(*config.AUG_JPEG_QUALITY))
    ok, buf = cv2.imencode(".jpg", img[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)[..., ::-1]


# ---- samples ----

class DetectSource:
    """Card images, empty backgrounds and real labelled frames, loaded once."""

    def __init__(self, card_images: list[Path], empty_frames: list[np.ndarray], real_train: list[RealFrame]):
        self.card_images = card_images
        self.empty_frames = empty_frames
        self.real_train = [f for f in real_train if f.corners]  # real card frames (empties are backgrounds)
        self._real_cache: dict[Path, np.ndarray] = {}

    def synthetic(self, rng: np.random.Generator) -> Sample:
        # Work at a camera-like aspect (16:9 mostly, some 4:3) at 2× output, then stretch like the app does.
        w, h = (OUT_W * 2, int(OUT_W * 2 * 9 / 16)) if rng.random() < 0.8 else (OUT_W * 2, int(OUT_W * 2 * 3 / 4))
        if self.empty_frames and rng.random() < 0.7:
            img = real_background(self.empty_frames[int(rng.integers(0, len(self.empty_frames)))], rng, w, h)
        else:
            img = procedural_background(rng, w, h)
        if rng.random() < config.DETECT_DISTRACTOR_P:
            img = distractors(img, rng)
        corners, present = np.zeros((4, 2), np.float32), 0.0
        quad = None if rng.random() < config.DETECT_EMPTY_P else card_quad(rng, w, h)
        if quad is not None:
            card = load_rgb(self.card_images[int(rng.integers(0, len(self.card_images)))])
            img = paste_card(img, card, quad)
            if rng.random() < config.DETECT_HAND_P:
                img = fingers(img, quad, rng)
            corners, present = quad / np.array([w, h], np.float32), 1.0
        img = camera(img, rng)
        return Sample(cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA), corners.astype(np.float32), present)

    def real(self, rng: np.random.Generator) -> Sample:
        f = self.real_train[int(rng.integers(0, len(self.real_train)))]
        if f.png not in self._real_cache:
            self._real_cache[f.png] = cv2.resize(load_rgb(f.png), (OUT_W * 2, OUT_H * 2), interpolation=cv2.INTER_AREA)
        img = self._real_cache[f.png]
        corners = np.array(f.corners, np.float32) / np.array([f.width, f.height], np.float32)
        img, corners = zoom_shift(img, corners, rng)
        img = camera(img, rng) if rng.random() < 0.5 else img
        return Sample(cv2.resize(img, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA), corners, 1.0)

    def sample(self, seed: int, index: int) -> Sample:
        rng = np.random.default_rng([config.SEED, seed, index])
        if self.real_train and rng.random() < config.DETECT_REAL_P:
            return self.real(rng)
        return self.synthetic(rng)


def zoom_shift(img: np.ndarray, corners: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Random zoom (0.85–1.15) and shift that keeps every corner inside the frame."""
    h, w = img.shape[:2]
    for _ in range(8):
        s = rng.uniform(0.85, 1.15)
        tx, ty = rng.uniform(-0.1, 0.1) * w, rng.uniform(-0.1, 0.1) * h
        m = np.array([[s, 0, (1 - s) * w / 2 + tx], [0, s, (1 - s) * h / 2 + ty]], np.float32)
        px = corners * np.array([w, h], np.float32)
        moved = px @ m[:, :2].T + m[:, 2]
        if (moved >= 1).all() and (moved[:, 0] <= w - 1).all() and (moved[:, 1] <= h - 1).all():
            out = cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REFLECT_101)
            return out, (moved / np.array([w, h], np.float32)).astype(np.float32)
    return img, corners


def default_source(real_train: list[RealFrame] | None = None) -> DetectSource:
    """UI JPEGs (372×520, fast to decode; a card is ≤ ~200 px tall in the detector input) + empty real frames."""
    cards = sorted(config.APP_IMAGES.glob("*.jpg"))
    if not cards:
        raise SystemExit("no card images in app/public/data/images - run ingest.py")
    from detect_data import load_real
    frames = load_real(config.DETECT_REAL_DIR) if config.DETECT_REAL_DIR.exists() else []
    empties = [cv2.resize(load_rgb(f.png), (OUT_W * 2, int(OUT_W * 2 * f.height / f.width)), interpolation=cv2.INTER_AREA)
               for f in frames if f.corners is None]
    return DetectSource(cards, empties, real_train or [])


def draw(sample: Sample) -> np.ndarray:
    img = np.ascontiguousarray(sample.image.copy())
    if sample.present:
        pts = (sample.corners * np.array([OUT_W, OUT_H])).astype(np.int32)
        cv2.polylines(img, [pts], True, (0, 255, 0), 1, cv2.LINE_AA)
        cv2.circle(img, tuple(int(v) for v in pts[0]), 3, (255, 0, 0), -1)  # TL
    return img


def preview(n: int = 24, cols: int = 4) -> Path:
    src = default_source()
    tiles = [draw(src.sample(0, i)) for i in range(n)]
    rows = [np.concatenate(tiles[r * cols:(r + 1) * cols], axis=1) for r in range(n // cols)]
    out = config.OUT_DIR / "detect_preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.concatenate(rows, axis=0)[..., ::-1])
    print(f"detect preview: {out} ({len(src.card_images)} card images, {len(src.empty_frames)} empty real frames; "
          f"green = card outline, red dot = top-left corner)")
    return out


if __name__ == "__main__":
    preview()

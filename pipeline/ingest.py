"""Validate cards.csv + images → app/public/data/cards.json + UI images  (PLAN.md §4.2)

UI images are downsized JPEGs (not copies of the 744×1039 PNGs): the price card
only needs ~370px, and copying 1.1GB of PNGs into the app is wasteful.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from PIL import Image

import config
from cardsio import FOIL_SUFFIX, read_csv
from packmode import pool_of
from sources.base import VARIANTS


class ValidationError(Exception):
    pass


def validate(cards: list[dict], images_dir: Path) -> None:
    errors = []
    ids = Counter(c["printing_id"] for c in cards)
    errors += [f"duplicate printing_id {i}" for i, n in ids.items() if n > 1]
    for c in cards:
        pid = c["printing_id"]
        if c["variant"] not in VARIANTS:
            errors.append(f"{pid}: bad variant {c['variant']!r}")
        if c["variant"] == "foil" and pid[: -len(FOIL_SUFFIX)] not in ids:
            errors.append(f"{pid}: foil row without base printing")
        if not c["image_hash"]:
            errors.append(f"{pid}: missing image_hash")
        path = images_dir / c["image_file"]
        if not c["image_file"] or not path.exists():
            errors.append(f"{pid}: image missing ({c['image_file']!r})")
    if errors:
        raise ValidationError(f"{len(errors)} problems in cards.csv:\n  " + "\n  ".join(errors[:20]))


def ui_image_name(image_file: str) -> str:
    return Path(image_file).with_suffix(".jpg").name


def to_card_json(c: dict) -> dict:
    return {
        "printingId": c["printing_id"], "name": c["name"], "setCode": c["set_code"],
        "collectorNumber": c["collector_number"], "rarity": c["rarity"], "variant": c["variant"],
        "imageHash": c["image_hash"], "imageUrl": f"/data/images/{ui_image_name(c['image_file'])}",
        # cards.csv only holds pool printings, so any Nexus Night-set row is a Nexus Night promo.
        "pool": pool_of(c["set_code"]),
    }


def write_ui_image(src: Path, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return False
    with Image.open(src) as img:
        img.convert("RGB").resize((config.UI_IMAGE_W, config.UI_IMAGE_H), Image.LANCZOS) \
            .save(dest, "JPEG", quality=config.UI_IMAGE_QUALITY, optimize=True)
    return True


def main() -> None:
    cards = read_csv(config.CARDS_CSV)
    if not cards:
        raise SystemExit("cards.csv missing - run fetch_cards.py / fetch_prices.py first.")
    validate(cards, config.IMAGES_DIR)

    config.APP_IMAGES.mkdir(parents=True, exist_ok=True)
    written = 0
    for f in sorted({c["image_file"] for c in cards}):
        with Image.open(config.IMAGES_DIR / f) as img:
            img.verify()  # opens and is not truncated
        written += write_ui_image(config.IMAGES_DIR / f, config.APP_IMAGES / ui_image_name(f))
    (config.APP_DATA / "cards.json").write_text(json.dumps([to_card_json(c) for c in cards]), encoding="utf-8")

    size = sum(p.stat().st_size for p in config.APP_IMAGES.glob("*.jpg")) / 1e6
    print(f"cards.json: {len(cards)} printings, {len({c['name'] for c in cards})} names")
    print(f"variants: {dict(Counter(c['variant'] for c in cards))}")
    print(f"pools: {dict(Counter(pool_of(c['set_code']) for c in cards))}")
    print(f"UI images: {written} written, {size:.0f}MB total")


if __name__ == "__main__":
    main()

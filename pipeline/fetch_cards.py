"""Card source → data/raw + images → data/cards/cards.csv  (PLAN.md §4.0.3)

Usage: python fetch_cards.py [--source riftcodex] [--sets OGN ...] [--refresh] [--limit 20] [--no-images]
"""
from __future__ import annotations

import argparse
import io
import json
from collections import Counter

import imagehash
from PIL import Image

import config
import rawcache
from cardsio import CARD_COLUMNS, FOIL_SUFFIX, read_csv, write_csv
from httpclient import HttpClient
from imagehashing import canonicalize, report
from packmode import pool_of
from sources.base import CardRecord
from sources.riftcodex import RiftcodexSource

SOURCES = {"riftcodex": RiftcodexSource}


def is_nexus_night(r: CardRecord) -> bool:
    return pool_of(r.set_code, r.variant_tag) == "nexus_night"


def select_pool(records: list[CardRecord], sets: list[str]) -> list[CardRecord]:
    """Booster sets + Nexus Night promos, optionally plus every other printing of the same names."""
    if "ALL" in sets:
        return records
    pool = [r for r in records if r.set_code in sets or is_nexus_night(r)]
    if config.INCLUDE_ALL_PRINTINGS:
        names = {r.name for r in pool}
        extra = [r for r in records if r not in pool and r.name in names]
        by_set = Counter(r.set_code for r in extra)
        print(f"  printing coverage: +{len(extra)} printings from other sets {dict(by_set)}")
        pool += extra
    return pool


def load_image(http: HttpClient, rec: CardRecord, url_cache: dict[str, bytes]) -> tuple[Image.Image, str]:
    override = config.IMAGE_OVERRIDES_DIR / f"{rec.printing_id}.png"
    if override.exists():
        return Image.open(override), "override"
    if rec.image_url not in url_cache:
        url_cache[rec.image_url] = http.get_bytes(rec.image_url)
    return Image.open(io.BytesIO(url_cache[rec.image_url])), "downloaded"


def ensure_image(http: HttpClient, rec: CardRecord, url_cache: dict[str, bytes], stats: Counter) -> str:
    """Download/convert once; returns the image file name. Landscape cards are rotated to portrait."""
    fname = f"{rec.printing_id}.png"
    dest = config.IMAGES_DIR / fname
    override = config.IMAGE_OVERRIDES_DIR / fname
    if dest.exists() and not (override.exists() and override.stat().st_mtime > dest.stat().st_mtime):
        stats["skipped"] += 1
        return fname
    img, how = load_image(http, rec, url_cache)
    img = img.convert("RGB")
    if img.width > img.height:  # battlefields: held turned sideways in the portrait guide box
        img = img.rotate(90, expand=True)
        stats["rotated"] += 1
    img.save(dest, "PNG")
    stats[how] += 1
    return fname


def image_row(rec: CardRecord, image_file: str, image_hash: str) -> dict:
    return {
        "printing_id": rec.printing_id, "name": rec.name, "set_code": rec.set_code,
        "collector_number": rec.collector_number, "rarity": rec.rarity, "variant": rec.variant,
        "image_file": image_file, "image_hash": image_hash, "source": rec.source,
        "source_id": rec.source_id, "tcgplayer_id": rec.tcgplayer_id or "",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=config.CARD_SOURCE, choices=SOURCES)
    ap.add_argument("--sets", nargs="+", default=config.DEMO_SETS)
    ap.add_argument("--refresh", action="store_true", help="ignore cached raw data and re-fetch")
    ap.add_argument("--limit", type=int, default=None, help="only the first N printings (smoke test)")
    ap.add_argument("--no-images", action="store_true")
    args = ap.parse_args()

    source = SOURCES[args.source]()
    raw = None if args.refresh else rawcache.newest_dir(source.name)
    if raw is None:
        print(f"Fetching raw data from {source.name} ...")
        raw = source.fetch_raw(args.sets)
    else:
        print(f"Using cached raw data: {raw}")

    pool = select_pool(source.parse(raw), args.sets)
    if args.limit:
        pool = pool[: args.limit]
    ids = [r.printing_id for r in pool]
    dupes = [i for i, n in Counter(ids).items() if n > 1]
    if dupes:
        raise SystemExit(f"Duplicate printing_ids: {dupes[:10]}")

    http = HttpClient()  # images: persisted as PNGs, not in the JSON cache
    config.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    config.IMAGE_OVERRIDES_DIR.mkdir(parents=True, exist_ok=True)
    stats: Counter = Counter()
    url_cache: dict[str, bytes] = {}
    rows = []
    for i, rec in enumerate(pool, 1):
        fname, phash = "", ""
        if not args.no_images or (config.IMAGES_DIR / f"{rec.printing_id}.png").exists():
            fname = ensure_image(http, rec, url_cache, stats)
            with Image.open(config.IMAGES_DIR / fname) as img:
                img.load()
                if img.height < config.MIN_IMAGE_HEIGHT:
                    print(f"  WARN low-res reference {fname}: {img.width}x{img.height}")
                phash = str(imagehash.phash(img))
        rows.append(image_row(rec, fname, phash))
        if i % 100 == 0:
            print(f"  images {i}/{len(pool)}")

    canonicalize(rows)

    # Keep foil rows that fetch_prices.py added earlier (prices are frozen; it won't re-run).
    kept_ids = {r["printing_id"] for r in rows}
    old_by_id = {r["printing_id"]: r for r in rows}
    for old in read_csv(config.CARDS_CSV):
        base = old["printing_id"][: -len(FOIL_SUFFIX)]
        if old["variant"] == "foil" and base in kept_ids:
            b = old_by_id[base]
            rows.append({**old, "image_file": b["image_file"], "image_hash": b["image_hash"]})

    write_csv(config.CARDS_CSV, rows, CARD_COLUMNS)
    rep = report(rows)
    config.LOOKALIKE_REPORT.write_text(json.dumps(rep, indent=1), encoding="utf-8")

    print(f"\nSource: {source.name}  raw: {raw.name}")
    print(f"Sets: {dict(sorted(Counter(r['set_code'] for r in rows).items()))}")
    print(f"Printings: {len(rows)}  names: {len({r['name'] for r in rows})}")
    print(f"Variants: {dict(Counter(r['variant'] for r in rows))}")
    print(f"Images: {dict(stats)}")
    print(f"Look-alike groups (same name, >1 picture): {len(rep['lookalike_groups'])}")
    print(f"Promo/alt-art reusing a normal printing's picture: {len(rep['reused_image_variants'])}")
    print(f"Report: {config.LOOKALIKE_REPORT}")
    print(http.summary())


if __name__ == "__main__":
    main()

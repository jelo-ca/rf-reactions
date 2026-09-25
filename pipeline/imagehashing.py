"""pHash helpers: canonical hashes per card name, look-alike + reused-image reports."""
from __future__ import annotations

from collections import defaultdict

import imagehash

import config


def hamming(a: str, b: str) -> int:
    return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)


def canonicalize(rows: list[dict]) -> None:
    """Within each card name, snap near-identical hashes to one canonical value.

    Contract: same image_hash = same picture. Re-encoded copies of one picture
    differ by a few bits, so cluster by Hamming distance ≤ PHASH_SAME_MAX_DIST.
    Mutates rows' image_hash in place.
    """
    by_name: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["image_hash"]:
            by_name[r["name"]].append(r)
    for group in by_name.values():
        canon: list[str] = []
        for r in group:
            match = next((c for c in canon if hamming(c, r["image_hash"]) <= config.PHASH_SAME_MAX_DIST), None)
            if match is None:
                canon.append(r["image_hash"])
            else:
                r["image_hash"] = match


def report(rows: list[dict]) -> dict:
    """Look-alike groups (same name, >1 picture) and reused-image variants."""
    by_name: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_name[r["name"]].append(r)
    lookalikes, reused = {}, []
    for name, group in sorted(by_name.items()):
        hashes = defaultdict(list)
        for r in group:
            hashes[r["image_hash"]].append(r["printing_id"])
        if len(hashes) > 1:
            lookalikes[name] = list(hashes.values())
        normal_hashes = {r["image_hash"] for r in group if r["variant"] == "normal"}
        for r in group:
            if r["variant"] in ("promo", "alt_art") and r["image_hash"] in normal_hashes:
                base = [g["printing_id"] for g in group if g["variant"] == "normal" and g["image_hash"] == r["image_hash"]]
                reused.append({"printing_id": r["printing_id"], "same_picture_as": base})
    return {"lookalike_groups": lookalikes, "reused_image_variants": reused}

"""CSV read/write for cards.csv and prices.csv (contracts in PLAN.md §3)."""
from __future__ import annotations

import csv
from pathlib import Path

CARD_COLUMNS = [
    "printing_id", "name", "set_code", "collector_number", "rarity", "variant",
    "image_file", "image_hash", "source", "source_id", "tcgplayer_id",
]
PRICE_COLUMNS = ["printing_id", "price_usd", "price_field", "source", "as_of", "match_method"]
FOIL_SUFFIX = "F"


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

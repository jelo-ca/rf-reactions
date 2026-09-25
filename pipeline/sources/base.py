from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

VARIANTS = ("normal", "foil", "alt_art", "promo")


@dataclass
class CardRecord:
    printing_id: str
    name: str
    set_code: str
    collector_number: str   # zero-padded, keeps suffix: "001", "007a", "306*"
    rarity: str
    variant: str            # normal | alt_art | promo  (foil rows are added by fetch_prices)
    image_url: str
    source: str
    source_id: str
    tcgplayer_id: str | None
    orientation: str = "portrait"


@dataclass
class PriceRecord:
    printing_id: str
    price_usd: float
    price_field: str        # marketPrice | midPrice | lowPrice | manual
    source: str
    as_of: str
    match_method: str       # tcgplayer_id | set_and_number | name_and_set | manual


class CardSource(Protocol):
    name: str
    def fetch_raw(self, sets: list[str]) -> Path: ...          # writes data/raw/<source>/<ts>/, returns that dir
    def parse(self, raw_dir: Path) -> list[CardRecord]: ...     # pure, no network


class PriceSource(Protocol):
    # Cards are cards.csv rows (dicts): prices are matched after images/hashes exist.
    name: str
    def fetch_raw(self, cards: list[dict]) -> Path: ...
    def parse(self, raw_dir: Path, cards: list[dict]) -> list[PriceRecord]: ...

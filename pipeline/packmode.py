"""Pack mode (PLAN.md §6.4b): what kind of pack is being opened.

Reference implementation for eval.py; app/src/vision/packMode.ts must match.
Cards are cards.json dicts (camelCase), prices map printingId → USD.
"""
from __future__ import annotations

import config

POOLS = ("booster", "nexus_night")
PACK_MODES = POOLS
DEFAULT_PACK_MODE = "booster"


def pool_of(set_code: str, variant_tag: str | None = None) -> str:
    """Nexus Night = untagged printings of the Nexus Night set (same rule as the pool filter)."""
    return "nexus_night" if set_code == config.NEXUS_NIGHT_SET and not variant_tag else "booster"


def allowed(card: dict, mode: str) -> bool:
    """Booster packs can't contain Nexus Night printings; Nexus Night packs may contain anything."""
    if mode not in PACK_MODES:
        raise ValueError(f"unknown pack mode {mode!r}")
    return mode == "nexus_night" or card["pool"] != "nexus_night"


def filter_candidates(cards: list[dict], mode: str) -> list[dict]:
    return [c for c in cards if allowed(c, mode)]


def pick_same_picture(group: list[dict], prices: dict[str, float], mode: str) -> dict:
    """Choose one printing from a same-picture group (§6.4 rule 6 + §6.4b)."""
    group = filter_candidates(group, mode)
    if not group:
        raise ValueError("no allowed printing in group")
    if mode == "nexus_night":
        nn = [c for c in group if c["pool"] == "nexus_night"]
        if nn:
            group = nn
    return min(group, key=lambda c: (prices[c["printingId"]], c["printingId"]))

"""One-time TCGCSV price snapshot → prices.csv + unmatched.csv  (PLAN.md §4.0.5)

Usage: python fetch_prices.py [--force]
Frozen by default: exits if prices.csv exists. Re-running after editing
manual_overrides.csv? Use --rematch (re-parses the cached snapshot, 0 requests).
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import asdict

import config
import rawcache
from cardsio import CARD_COLUMNS, FOIL_SUFFIX, PRICE_COLUMNS, read_csv, write_csv
from sources.prices_tcgcsv import MatchResult, TcgcsvSource

UNMATCHED_COLUMNS = ["printing_id", "name", "set_code", "collector_number", "variant", "tcgplayer_id", "reason"]


def riftcodex_group_ids() -> dict[str, str]:
    raw = rawcache.newest_dir("riftcodex")
    if raw is None:
        return {}
    sets = json.loads((raw / "sets.json").read_text(encoding="utf-8"))["items"]
    return {s["set_id"]: s["tcgplayer_id"] for s in sets if s.get("tcgplayer_id")}


def merge(base_cards: list[dict], res: MatchResult, overrides: list[dict]) -> tuple[list[dict], list[dict]]:
    """Pure: add foil printings, apply manual overrides (they win). Returns (cards, price rows)."""
    by_id = {c["printing_id"]: c for c in base_cards}
    # Foil rows: one per card with a separate foil price; same image, embeds identically.
    clash = [f for f in res.foil_of if f in by_id]
    if clash:
        raise SystemExit(f"foil printing_id collides with existing id: {clash[:5]}")
    foil_rows = [{**by_id[b], "printing_id": f, "variant": "foil"} for f, b in res.foil_of.items()]

    prices = {p.printing_id: asdict(p) for p in res.prices}
    for o in overrides:  # a new "<id>F" override creates the foil printing
        pid = o["printing_id"]
        if pid not in by_id and pid not in res.foil_of:
            base = pid[: -len(FOIL_SUFFIX)]
            if pid.endswith(FOIL_SUFFIX) and base in by_id:
                foil_rows.append({**by_id[base], "printing_id": pid, "variant": "foil"})
                res.foil_of[pid] = base
            else:
                print(f"  WARN override for unknown printing {pid} ignored")
                continue
        prices[pid] = {**o, "price_usd": float(o["price_usd"]), "match_method": "manual",
                       "price_field": o.get("price_field") or "manual"}

    all_cards = base_cards + foil_rows
    return all_cards, [prices[c["printing_id"]] for c in all_cards if c["printing_id"] in prices]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="fetch a NEW snapshot (network)")
    ap.add_argument("--rematch", action="store_true", help="re-run matching + overrides on the cached snapshot")
    args = ap.parse_args()

    if config.PRICES_CSV.exists() and not (args.force or args.rematch):
        print(f"{config.PRICES_CSV} exists — prices are frozen. Use --rematch (offline) or --force (new snapshot).")
        return
    cards = read_csv(config.CARDS_CSV)
    if not cards:
        raise SystemExit("cards.csv missing — run fetch_cards.py first.")
    base_cards = [c for c in cards if c["variant"] != "foil"]

    source = TcgcsvSource()
    raw = None if args.force else rawcache.newest_dir(source.name)
    if raw is None:
        print("Fetching TCGCSV snapshot ...")
        raw = source.fetch_raw(base_cards, riftcodex_group_ids())
    else:
        print(f"Using cached snapshot: {raw}")
    manifest = json.loads((raw / "manifest.json").read_text(encoding="utf-8"))

    res = source.match(raw, base_cards)
    all_cards, price_rows = merge(base_cards, res, read_csv(config.MANUAL_OVERRIDES_CSV))
    foil_rows = [c for c in all_cards if c["variant"] == "foil"]
    write_csv(config.CARDS_CSV, all_cards, CARD_COLUMNS)
    write_csv(config.PRICES_CSV, price_rows, PRICE_COLUMNS)
    priced = {p["printing_id"] for p in price_rows}
    unmatched = [u for u in res.unmatched if u["printing_id"] not in priced]
    write_csv(config.UNMATCHED_CSV, unmatched, UNMATCHED_COLUMNS)
    if not config.MANUAL_OVERRIDES_CSV.exists():
        write_csv(config.MANUAL_OVERRIDES_CSV, [], PRICE_COLUMNS)

    auto = sum(1 for p in price_rows if p["match_method"] != "manual")
    print(f"\nSnapshot as_of: {manifest['last_updated']}  groups: {manifest['set_to_group']}")
    print(f"Price requests used: {manifest['requests']} / {config.PRICE_MAX_REQUESTS}")
    print(f"Printings: {len(all_cards)} ({len(foil_rows)} foil rows)")
    print(f"Priced: {len(price_rows)}  auto: {auto} ({100 * auto / len(all_cards):.1f}%)  manual: {len(price_rows) - auto}")
    print(f"Match methods: {dict(Counter(p['match_method'] for p in price_rows))}")
    print(f"Price fields: {dict(Counter(p['price_field'] for p in price_rows))}")
    print(f"Unmatched: {len(unmatched)} {dict(Counter(u['reason'].split('(')[0] for u in unmatched))} → {config.UNMATCHED_CSV}")
    if unmatched:
        print("🧑 HUMAN (H3): fill gaps in data/prices/manual_overrides.csv, then run: python fetch_prices.py --rematch")


if __name__ == "__main__":
    main()

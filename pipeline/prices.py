"""prices.csv (frozen snapshot, overrides merged) → app/public/data/prices.json  (PLAN.md §7)

No network. Fails loudly unless every printing in cards.csv has exactly one price.
"""
from __future__ import annotations

import json
import math
from collections import Counter

import config
from cardsio import read_csv


class PriceError(Exception):
    pass


def build(cards: list[dict], prices: list[dict]) -> list[dict]:
    ids = {c["printing_id"] for c in cards}
    counts = Counter(p["printing_id"] for p in prices)
    errors = [f"{i}: no price" for i in sorted(ids - counts.keys())]
    errors += [f"{i}: {n} price rows" for i, n in counts.items() if n > 1]
    errors += [f"{i}: price for unknown printing" for i in sorted(counts.keys() - ids)]
    out = []
    for p in prices:
        try:
            usd = float(p["price_usd"])
        except ValueError:
            usd = math.nan
        if not math.isfinite(usd) or usd < 0:
            errors.append(f"{p['printing_id']}: bad price {p['price_usd']!r}")
        out.append({"printingId": p["printing_id"], "priceUsd": usd, "source": p["source"], "asOf": p["as_of"]})
    if errors:
        raise PriceError(f"{len(errors)} price problems (a missing price fails the build, not the demo):\n  "
                         + "\n  ".join(errors[:20]))
    return out


def main() -> None:
    out = build(read_csv(config.CARDS_CSV), read_csv(config.PRICES_CSV))
    config.APP_DATA.mkdir(parents=True, exist_ok=True)
    (config.APP_DATA / "prices.json").write_text(json.dumps(out), encoding="utf-8")
    vals = sorted(p["priceUsd"] for p in out)
    print(f"prices.json: {len(out)} prices, median ${vals[len(vals) // 2]:.2f}, max ${vals[-1]:.2f}")


if __name__ == "__main__":
    main()

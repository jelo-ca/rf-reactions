// Acceptance (PLAN.md §7): every printing in the pool has a price, so a missing price fails the
// build, not the demo. Checks the generated files in public/data (pipeline/prices.py checks the CSVs).
import { describe, expect, it } from "vitest";
import type { Card, Price } from "../types";

// Glob, not a plain import: public/data is generated and gitignored, so it may be absent.
const files = import.meta.glob<unknown>("../../public/data/{cards,prices}.json", { eager: true, import: "default" });
const cards = files["../../public/data/cards.json"] as Card[] | undefined;
const prices = files["../../public/data/prices.json"] as Price[] | undefined;
const present = !!cards && !!prices;
if (!present) console.warn("public/data missing - run scripts/build_data.sh; skipping the price coverage check");

describe.skipIf(!present)("generated price data", () => {
  it("has one price per printing, no more, no less", () => {
    const priceIds = prices!.map((p) => p.printingId);
    expect(new Set(priceIds).size).toBe(priceIds.length);
    expect([...new Set(priceIds)].sort()).toEqual(cards!.map((c) => c.printingId).sort());
  });

  it("every printing's price is a finite number >= 0 with a parsable snapshot time", () => {
    const bad = prices!.filter(
      (p) => typeof p.priceUsd !== "number" || !Number.isFinite(p.priceUsd) || p.priceUsd < 0 || Number.isNaN(Date.parse(p.asOf)),
    );
    expect(bad).toEqual([]);
  });
});

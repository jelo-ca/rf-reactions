import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import { countUp, sampleCardForTier } from "./helpers";
import type { TierConfig } from "./tiers";

const CFG: TierConfig = {
  mode: "price",
  priceTiers: [
    { tier: 0, maxUsd: 1 }, { tier: 1, maxUsd: 5 }, { tier: 2, maxUsd: 20 },
    { tier: 3, maxUsd: 75 }, { tier: 4, maxUsd: 200 }, { tier: 5, maxUsd: null },
  ],
  rarityTiers: { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Showcase: 5, Promo: 4 },
  foilBonus: 1,
  names: ["a", "b", "c", "d", "e", "f"],
  sounds: {},
};
const card = (printingId: string, extra: Partial<Card> = {}): Card => ({
  printingId, name: printingId, setCode: "OGN", setName: "Origins", collectorNumber: "001", rarity: "Common",
  variant: "normal", imageHash: printingId, imageUrl: "", pool: "booster", ...extra,
});

describe("countUp", () => {
  it("starts at 0, eases up, and lands exactly on the target", () => {
    expect(countUp(1359.58, 0, 1400)).toBe(0);
    const mid = countUp(1359.58, 700, 1400);
    expect(mid).toBeGreaterThan(1359.58 / 2); // ease-out: past halfway at half time
    expect(mid).toBeLessThan(1359.58);
    expect(countUp(1359.58, 1400, 1400)).toBe(1359.58);
    expect(countUp(1359.58, 99999, 1400)).toBe(1359.58);
  });
  it("is monotonic and in whole cents", () => {
    let prev = 0;
    for (let ms = 0; ms <= 1400; ms += 50) {
      const v = countUp(57.31, ms, 1400);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(Math.round(v * 100) / 100).toBe(v);
      prev = v;
    }
  });
  it("handles a zero duration", () => {
    expect(countUp(5, 0, 0)).toBe(5);
  });
});

describe("sampleCardForTier", () => {
  const cards = [
    card("cheap"), card("mid"), card("rich"), card("richer"),
    card("nn", { pool: "nexus_night" }), card("show", { rarity: "Showcase" }),
  ];
  const prices = new Map([["cheap", 0.1], ["mid", 12], ["rich", 300], ["richer", 1300], ["nn", 5000], ["show", 0.5]]);

  it("picks the priciest booster card on that tier", () => {
    expect(sampleCardForTier(cards, prices, CFG, "price", 5)?.printingId).toBe("richer");
    expect(sampleCardForTier(cards, prices, CFG, "price", 2)?.printingId).toBe("mid");
    expect(sampleCardForTier(cards, prices, CFG, "price", 0)?.printingId).toBe("show");
  });
  it("follows the mode", () => {
    expect(sampleCardForTier(cards, prices, CFG, "rarity", 5)?.printingId).toBe("show");
  });
  it("returns undefined when nothing maps to the tier", () => {
    expect(sampleCardForTier(cards, prices, CFG, "price", 3)).toBeUndefined();
  });
});

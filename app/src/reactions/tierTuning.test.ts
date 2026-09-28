import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import type { TierConfig } from "./tiers";
import {
  loadPriceLimits, parseLimits, priceLimits, priceTiersJson, savePriceLimits, tierCounts, withPriceLimits,
} from "./tierTuning";

const CFG: TierConfig = {
  mode: "price",
  priceTiers: [
    { tier: 0, maxUsd: 1 }, { tier: 1, maxUsd: 5 }, { tier: 2, maxUsd: 20 },
    { tier: 3, maxUsd: 75 }, { tier: 4, maxUsd: 200 }, { tier: 5, maxUsd: null },
  ],
  rarityTiers: { Common: 0, Showcase: 5 },
  foilBonus: 1,
  names: ["a", "b", "c", "d", "e", "f"],
  sounds: {},
};
const card = (printingId: string, extra: Partial<Card> = {}): Card => ({
  printingId, name: printingId, setCode: "OGN", setName: "Origins", collectorNumber: "001", rarity: "Common",
  variant: "normal", imageHash: printingId, imageUrl: "", pool: "booster", ...extra,
});

describe("price limits", () => {
  it("round-trips the config's limits", () => {
    expect(priceLimits(CFG)).toEqual([1, 5, 20, 75, 200]);
    expect(withPriceLimits(CFG, [1, 5, 20, 75, 200])).toEqual(CFG);
  });
  it("applies new limits and keeps the open-ended top tier", () => {
    const c = withPriceLimits(CFG, [0.5, 2, 10, 50, 150]);
    expect(c.priceTiers.at(-1)).toEqual({ tier: 5, maxUsd: null });
    expect(c.priceTiers[0].maxUsd).toBe(0.5);
  });
  it("rejects bad limits", () => {
    expect(() => withPriceLimits(CFG, [1, 5, 20])).toThrow(/5 limits/);
    expect(() => withPriceLimits(CFG, [1, 5, 4, 75, 200])).toThrow(/above the previous/);
    expect(() => withPriceLimits(CFG, [0, 5, 20, 75, 200])).toThrow(/above \$0/);
  });
});

describe("parseLimits", () => {
  it("accepts dollar signs, commas and spaces", () => {
    expect(parseLimits(["$1", " 5 ", "20", "$1,000", "2,500.50"])).toEqual({ limits: [1, 5, 20, 1000, 2500.5], error: null });
  });
  it("explains what's wrong", () => {
    expect(parseLimits(["1", "", "20"]).error).toMatch(/tier 1/);
    expect(parseLimits(["1", "abc"]).error).toMatch(/tier 1/);
    expect(parseLimits(["5", "2"]).error).toMatch(/tier 1 must be above tier 0/);
  });
});

describe("tierCounts", () => {
  it("counts booster printings per tier in the current mode", () => {
    const cards = [card("a"), card("b"), card("c"), card("nn", { pool: "nexus_night" }), card("s", { rarity: "Showcase" })];
    const prices = new Map([["a", 0.1], ["b", 3], ["c", 500], ["nn", 500], ["s", 0.5]]);
    expect(tierCounts(cards, prices, CFG, "price")).toEqual([2, 1, 0, 0, 0, 1]);
    expect(tierCounts(cards, prices, CFG, "rarity")).toEqual([3, 0, 0, 0, 0, 1]);
  });
});

describe("priceTiersJson", () => {
  it("is valid JSON to paste into tiers.json", () => {
    expect(JSON.parse(`{${priceTiersJson(CFG)}}`).priceTiers).toEqual(CFG.priceTiers);
  });
});

describe("storage", () => {
  it("saves, loads, clears and survives junk or blocked storage", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadPriceLimits(s)).toBeNull();
    savePriceLimits([1, 2, 3], s);
    expect(loadPriceLimits(s)).toEqual([1, 2, 3]);
    savePriceLimits(null, s);
    expect(loadPriceLimits(s)).toBeNull();
    m.set("riftpulls.priceLimits", "{nope");
    expect(loadPriceLimits(s)).toBeNull();
    const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(loadPriceLimits(boom)).toBeNull();
    expect(() => savePriceLimits([1], boom)).not.toThrow();
  });
});

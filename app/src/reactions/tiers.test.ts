import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import {
  loadTierMode, nextTierMode, resolveTier, saveTierMode, tierByPrice, tierByRarity, type TierConfig, validateTiers,
} from "./tiers";

// Mirrors public/data/tiers.json.
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
const card = (extra: Partial<Card> = {}): Card => ({
  printingId: "OGN-001", name: "N", setCode: "OGN", setName: "Origins", collectorNumber: "001", rarity: "Common",
  variant: "normal", imageHash: "h", imageUrl: "", pool: "booster", ...extra,
});

describe("tierByPrice", () => {
  it("uses inclusive upper bounds", () => {
    expect([0, 0.05, 1, 1.01, 5, 19.99, 20, 75, 75.01, 200, 200.01, 3624.82].map((p) => tierByPrice(p, CFG)))
      .toEqual([0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });
});

describe("tierByRarity (hype mode)", () => {
  it("maps each rarity", () => {
    expect(["Common", "Uncommon", "Rare", "Epic", "Showcase", "Promo"].map((rarity) => tierByRarity(card({ rarity }), CFG)))
      .toEqual([0, 1, 2, 3, 5, 4]);
  });
  it("bumps foils and caps at the top tier", () => {
    expect(tierByRarity(card({ rarity: "Uncommon", variant: "foil" }), CFG)).toBe(2);
    expect(tierByRarity(card({ rarity: "Showcase", variant: "foil" }), CFG)).toBe(5);
  });
  it("treats an unknown rarity as tier 0", () => {
    expect(tierByRarity(card({ rarity: "Mythic?" }), CFG)).toBe(0);
  });
});

describe("resolveTier", () => {
  const showcase = card({ rarity: "Showcase" });
  it("switches mapping with the mode", () => {
    expect(resolveTier(showcase, 1.31, CFG, "price")).toBe(1);
    expect(resolveTier(showcase, 1.31, CFG, "rarity")).toBe(5);
  });
  it("falls back to rarity when the price is missing", () => {
    expect(resolveTier(showcase, undefined, CFG, "price")).toBe(5);
    expect(resolveTier(showcase, NaN, CFG, "price")).toBe(5);
  });
});

describe("validateTiers", () => {
  it("accepts the shipped config", () => {
    expect(validateTiers(CFG)).toEqual(CFG);
  });
  it("defaults missing sounds to none", () => {
    const { sounds: _, ...rest } = CFG;
    expect(validateTiers(rest).sounds).toEqual({});
  });
  it.each([
    [{ mode: "vibes" }, /mode/],
    [{ priceTiers: [] }, /empty/],
    [{ priceTiers: [{ tier: 0, maxUsd: 5 }, { tier: 1, maxUsd: 1 }, { tier: 2, maxUsd: null }] }, /above the previous/],
    [{ priceTiers: [{ tier: 0, maxUsd: 1 }, { tier: 1, maxUsd: 5 }] }, /must be null/],
    [{ priceTiers: [{ tier: 1, maxUsd: null }] }, /tier must be 0/],
    [{ rarityTiers: { Common: 9 } }, /rarityTiers.Common/],
    [{ foilBonus: -1 }, /foilBonus/],
    [{ names: ["x"] }, /names/],
  ])("fails loudly on %j", (patch, msg) => {
    expect(() => validateTiers({ ...CFG, ...patch })).toThrow(msg);
  });
});

describe("tier mode storage", () => {
  it("round-trips and falls back on junk or blocked storage", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadTierMode("price", s)).toBe("price");
    saveTierMode("rarity", s);
    expect(loadTierMode("price", s)).toBe("rarity");
    m.set("riftpulls.tierMode", "junk");
    expect(loadTierMode("price", s)).toBe("price");
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadTierMode("rarity", boom)).toBe("rarity");
    expect(() => saveTierMode("price", boom)).not.toThrow();
  });
  it("toggles", () => {
    expect(nextTierMode("price")).toBe("rarity");
    expect(nextTierMode("rarity")).toBe("price");
  });
});

describe("shipped public/data/tiers.json", () => {
  const files = import.meta.glob<unknown>("../../public/data/tiers.json", { eager: true, import: "default" });
  it("is valid and matches the owner's 5-tier rework (2026-09-28; tiers 1 + 2 merged)", () => {
    const cfg = validateTiers(files["../../public/data/tiers.json"]);
    expect(cfg.priceTiers).toEqual([
      { tier: 0, maxUsd: 1 }, { tier: 1, maxUsd: 20 }, { tier: 2, maxUsd: 75 }, { tier: 3, maxUsd: 200 }, { tier: 4, maxUsd: null },
    ]);
    expect(cfg.rarityTiers).toEqual({ Common: 0, Uncommon: 1, Rare: 1, Epic: 2, Promo: 3, Showcase: 4 });
    expect(cfg.foilBonus).toBe(1);
    expect(cfg.names).toHaveLength(5);
  });
  it("has a reaction duration for every tier", async () => {
    const { CFG: app } = await import("../config");
    const cfg = validateTiers(files["../../public/data/tiers.json"]);
    expect(app.REACTION_MS).toHaveLength(cfg.priceTiers.length);
  });
});

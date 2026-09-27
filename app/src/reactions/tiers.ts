// Tier resolver (PLAN.md §8.1): card + price → reaction tier, by price or by rarity ("hype mode", H).
// The mapping lives in public/data/tiers.json (config, not code).
import type { Card } from "../types";

export type TierMode = "price" | "rarity";
export const TIER_MODES: readonly TierMode[] = ["price", "rarity"];

export interface TierConfig {
  mode: TierMode; // default until the viewer toggles H
  priceTiers: { tier: number; maxUsd: number | null }[]; // ascending; last has maxUsd null
  rarityTiers: Record<string, number>;
  foilBonus: number; // hype mode: foils go up this many tiers
  names: string[]; // one per tier, for the dev panel / debug
  sounds: Record<string, string>; // optional per-tier audio override ("5": "/sounds/tier5.mp3")
}

/** Throws with every problem at once, so a bad tiers.json fails loudly at load, not mid-demo. */
export function validateTiers(raw: unknown): TierConfig {
  const c = raw as TierConfig;
  const errors: string[] = [];
  if (!c || typeof c !== "object") throw new Error("tiers.json: not an object");
  if (!TIER_MODES.includes(c.mode)) errors.push(`mode must be one of ${TIER_MODES.join("/")}`);
  const pt = Array.isArray(c.priceTiers) ? c.priceTiers : [];
  if (!pt.length) errors.push("priceTiers is empty");
  pt.forEach((t, i) => {
    if (t.tier !== i) errors.push(`priceTiers[${i}].tier must be ${i}`);
    const last = i === pt.length - 1;
    if (last ? t.maxUsd !== null : !(typeof t.maxUsd === "number" && Number.isFinite(t.maxUsd)))
      errors.push(`priceTiers[${i}].maxUsd must be ${last ? "null" : "a number"}`);
    if (i > 0 && typeof t.maxUsd === "number" && typeof pt[i - 1].maxUsd === "number" && t.maxUsd <= pt[i - 1].maxUsd!)
      errors.push(`priceTiers[${i}].maxUsd must be above the previous tier`);
  });
  const top = pt.length - 1;
  for (const [rarity, t] of Object.entries(c.rarityTiers ?? {}))
    if (!Number.isInteger(t) || t < 0 || t > top) errors.push(`rarityTiers.${rarity} must be 0..${top}`);
  if (!Number.isInteger(c.foilBonus) || c.foilBonus < 0) errors.push("foilBonus must be an integer >= 0");
  if (!Array.isArray(c.names) || c.names.length !== pt.length) errors.push(`names needs ${pt.length} entries`);
  if (c.sounds && typeof c.sounds !== "object") errors.push("sounds must be an object");
  if (errors.length) throw new Error(`tiers.json: ${errors.join("; ")}`);
  return { ...c, sounds: c.sounds ?? {} };
}

export function tierByPrice(priceUsd: number, cfg: TierConfig): number {
  const t = cfg.priceTiers.find((p) => p.maxUsd === null || priceUsd <= p.maxUsd);
  return t ? t.tier : cfg.priceTiers.length - 1;
}

export function tierByRarity(card: Card, cfg: TierConfig): number {
  const base = cfg.rarityTiers[card.rarity] ?? 0;
  const bonus = card.variant === "foil" ? cfg.foilBonus : 0;
  return Math.min(base + bonus, cfg.priceTiers.length - 1);
}

/** Price mode falls back to rarity when the price is missing, so a reaction always fires. */
export function resolveTier(card: Card, priceUsd: number | undefined, cfg: TierConfig, mode: TierMode): number {
  if (mode === "price" && priceUsd !== undefined && Number.isFinite(priceUsd)) return tierByPrice(priceUsd, cfg);
  return tierByRarity(card, cfg);
}

export const nextTierMode = (m: TierMode): TierMode => (m === "price" ? "rarity" : "price");

const STORAGE_KEY = "riftpulls.tierMode";

export function loadTierMode<F extends TierMode | null>(
  fallback: F,
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): TierMode | F {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    return v && (TIER_MODES as readonly string[]).includes(v) ? (v as TierMode) : fallback;
  } catch {
    return fallback;
  }
}

export function saveTierMode(mode: TierMode, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    /* private window / blocked storage: setting just isn't remembered */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

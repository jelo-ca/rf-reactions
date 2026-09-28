// Live tuning of the price thresholds from the tier panel (T). Pure; unit tested.
// The viewer's thresholds override public/data/tiers.json in this browser only; "Copy JSON" gives
// the priceTiers block to paste into tiers.json to make them the default.
import type { Card } from "../types";
import { resolveTier, type TierConfig, type TierMode, validateTiers } from "./tiers";

/** Upper bounds of every tier but the last (which has no limit). */
export const priceLimits = (cfg: TierConfig): number[] =>
  cfg.priceTiers.slice(0, -1).map((t) => t.maxUsd as number);

/** Same config with new limits; throws (validateTiers) if they aren't ascending positive numbers. */
export function withPriceLimits(cfg: TierConfig, limits: readonly number[]): TierConfig {
  if (limits.length !== cfg.priceTiers.length - 1) throw new Error(`need ${cfg.priceTiers.length - 1} limits`);
  if (limits.some((v) => !(v > 0))) throw new Error("limits must be above $0");
  const priceTiers = [...limits.map((maxUsd, tier) => ({ tier, maxUsd })), { tier: limits.length, maxUsd: null }];
  return validateTiers({ ...cfg, priceTiers });
}

/** Parse the panel's text inputs ("$1.50", "20") into limits; null + message if unusable. */
export function parseLimits(texts: readonly string[]): { limits: number[] | null; error: string | null } {
  const limits = texts.map((t) => Number(t.replace(/[$,\s]/g, "")));
  const bad = limits.findIndex((v) => !Number.isFinite(v) || v <= 0);
  if (bad >= 0) return { limits: null, error: `tier ${bad}: enter a price above $0` };
  const order = limits.findIndex((v, i) => i > 0 && v <= limits[i - 1]);
  if (order >= 0) return { limits: null, error: `tier ${order} must be above tier ${order - 1}` };
  return { limits, error: null };
}

/** How many booster printings land on each tier (the booster pool is what gets pulled). */
export function tierCounts(
  cards: readonly Card[], prices: ReadonlyMap<string, number>, cfg: TierConfig, mode: TierMode,
): number[] {
  const counts = cfg.priceTiers.map(() => 0);
  for (const c of cards) {
    if (c.pool === "booster") counts[resolveTier(c, prices.get(c.printingId), cfg, mode)]++;
  }
  return counts;
}

/** The priceTiers block for tiers.json. */
export const priceTiersJson = (cfg: TierConfig): string =>
  `"priceTiers": [\n${cfg.priceTiers.map((t) => `    { "tier": ${t.tier}, "maxUsd": ${t.maxUsd} }`).join(",\n")}\n  ]`;

const STORAGE_KEY = "riftpulls.priceLimits";

export function loadPriceLimits(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): number[] | null {
  try {
    const v = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "number") ? v : null;
  } catch {
    return null;
  }
}

/** null clears the override (back to tiers.json). */
export function savePriceLimits(
  limits: readonly number[] | null, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  try {
    if (limits) storage?.setItem(STORAGE_KEY, JSON.stringify(limits));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    /* private window / blocked storage: not remembered */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

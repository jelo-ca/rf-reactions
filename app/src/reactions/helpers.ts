// Small pure helpers for the reaction layer and the dev panel (unit tested).
import type { Card } from "../types";
import { resolveTier, type TierConfig, type TierMode } from "./tiers";

/** The card that just reacted is shown again (same printing, nothing else in between). */
export const isRepeat = (lastPrintingId: string | null, printingId: string): boolean => lastPrintingId === printingId;

/** Tier 5 price count-up: ease-out from 0 to `target`, whole cents, exactly `target` at the end. */
export function countUp(target: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return target;
  const t = Math.max(0, elapsedMs) / durationMs;
  const eased = 1 - (1 - t) ** 3;
  return Math.min(target, Math.round(target * eased * 100) / 100);
}

/**
 * A real card that lands on `tier` in `mode`, so the dev panel (T) shows a believable card + price.
 * Prefers the priciest match (funnier on stage); undefined if no card maps there.
 */
export function sampleCardForTier(
  cards: readonly Card[],
  prices: ReadonlyMap<string, number>,
  cfg: TierConfig,
  mode: TierMode,
  tier: number,
): Card | undefined {
  let best: Card | undefined;
  let bestPrice = -1;
  for (const c of cards) {
    if (c.pool !== "booster") continue;
    const p = prices.get(c.printingId);
    if (resolveTier(c, p, cfg, mode) !== tier) continue;
    if ((p ?? 0) > bestPrice) {
      best = c;
      bestPrice = p ?? 0;
    }
  }
  return best;
}

/**
 * Index of the first sample louder than `threshold`, so a recording starts on its first clap/horn
 * instead of on lead-in room noise. Returns 0 for silence (play from the start).
 */
export function firstSoundIndex(samples: Float32Array, threshold = 0.05): number {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= threshold) return i;
  return 0;
}

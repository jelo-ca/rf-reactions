// Pack mode (PLAN.md §6.4b). Must match pipeline/packmode.py (same tests in both).
import type { PackMode } from "../types";

export const PACK_MODES: readonly PackMode[] = ["booster", "nexus_night"];
export const DEFAULT_PACK_MODE: PackMode = "booster";

interface Pooled {
  printingId: string;
  pool: "booster" | "nexus_night";
}

/** Booster packs can't contain Nexus Night printings; Nexus Night packs may contain anything. */
export function allowed(card: Pooled, mode: PackMode): boolean {
  if (!PACK_MODES.includes(mode)) throw new Error(`unknown pack mode ${JSON.stringify(mode)}`);
  return mode === "nexus_night" || card.pool !== "nexus_night";
}

export function filterCandidates<T extends Pooled>(cards: readonly T[], mode: PackMode): T[] {
  return cards.filter((c) => allowed(c, mode));
}

/** Choose one printing from a same-picture group (§6.4 rule 6 + §6.4b). */
export function pickSamePicture<T extends Pooled>(
  group: readonly T[],
  prices: ReadonlyMap<string, number>,
  mode: PackMode,
): T {
  let candidates = filterCandidates(group, mode);
  if (candidates.length === 0) throw new Error("no allowed printing in group");
  if (mode === "nexus_night") {
    const nn = candidates.filter((c) => c.pool === "nexus_night");
    if (nn.length) candidates = nn;
  }
  return candidates.reduce((best, c) => {
    const pb = priceOf(prices, best.printingId);
    const pc = priceOf(prices, c.printingId);
    return pc < pb || (pc === pb && c.printingId < best.printingId) ? c : best;
  });
}

function priceOf(prices: ReadonlyMap<string, number>, id: string): number {
  const p = prices.get(id);
  if (p === undefined) throw new Error(`no price for ${id}`);
  return p;
}

// --- persisted setting (per-viewer convenience; storage may be unavailable) ---
const STORAGE_KEY = "riftpulls.packMode";

export function loadPackMode(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): PackMode {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    return v && (PACK_MODES as readonly string[]).includes(v) ? (v as PackMode) : DEFAULT_PACK_MODE;
  } catch {
    return DEFAULT_PACK_MODE;
  }
}

export function savePackMode(mode: PackMode, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    /* private window / blocked storage: setting just isn't remembered */
  }
}

export function nextPackMode(mode: PackMode): PackMode {
  return mode === "booster" ? "nexus_night" : "booster";
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

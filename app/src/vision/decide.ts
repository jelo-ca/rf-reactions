// Decision rule (PLAN.md §6.4 + pack mode §6.4b). Pure; unit tested.
// Step A: which card (name). Step B: which printing of that card.
import type { Card, LayoutScore, Match, PackMode, RecognitionReason, RecognitionResult } from "../types";
import { allowed, pickSamePicture } from "./packMode";

export interface DecideConfig {
  ACCEPT_T: number;
  MARGIN_T: number;
  EMBED_WEIGHT: number;
  LAYOUT_WEIGHT: number;
  LAYOUT_MARGIN_T: number;
}

export interface DecideInput {
  /** Best embedding score per printing (foils are never embedded, so they're absent). */
  scores: ReadonlyMap<string, number>;
  cards: ReadonlyMap<string, Card>;
  byName: ReadonlyMap<string, readonly Card[]>; // all printings of each card name
  prices: ReadonlyMap<string, number>;
  packMode: PackMode;
  /** Layout score of the live crop vs a printing's reference signature, or null if it has none. */
  layoutScoreFor: (printingId: string) => number | null;
  topN?: number;
}

export type Decision = Omit<RecognitionResult, "timings">;

export function decide(input: DecideInput, cfg: DecideConfig): Decision {
  const { scores, cards, byName, prices, packMode } = input;
  const ok = (id: string) => {
    const c = cards.get(id);
    return !!c && allowed(c, packMode);
  };

  const ranked: Match[] = [...scores]
    .filter(([id]) => ok(id))
    .map(([printingId, score]) => ({ printingId, score }))
    .sort((a, b) => b.score - a.score || (a.printingId < b.printingId ? -1 : 1));
  const top = ranked.slice(0, input.topN ?? 5);
  const base = { top, packMode };

  // --- Step A: which card -------------------------------------------------
  const best = ranked[0];
  if (!best) return { ...base, status: "rejected", reason: "low_score" };
  const bestName = cards.get(best.printingId)!.name;
  const runnerUp = ranked.find((m) => cards.get(m.printingId)!.name !== bestName);
  if (best.score < cfg.ACCEPT_T) return { ...base, status: "rejected", best, reason: "low_score" };
  if (runnerUp && best.score - runnerUp.score < cfg.MARGIN_T) {
    return { ...base, status: "rejected", best, reason: "low_margin" };
  }

  // --- Step B: which printing ----------------------------------------------
  const siblings = (byName.get(bestName) ?? []).filter((c) => allowed(c, packMode));
  const accept = (id: string, reason: RecognitionReason, layout?: LayoutScore[]): Decision => ({
    ...base,
    status: "accepted",
    best: { printingId: id, score: scores.get(id) ?? best.score },
    reason,
    ...(layout ? { layout } : {}),
  });
  if (siblings.length <= 1) return accept(best.printingId, "ok");

  const groups = new Map<string, Card[]>();
  for (const c of siblings) groups.set(c.imageHash, [...(groups.get(c.imageHash) ?? []), c]);

  if (groups.size === 1) {
    const pick = pickSamePicture(siblings, prices, packMode);
    return accept(pick.printingId, "same_image_cheapest");
  }

  // Different pictures: combine embedding and layout per picture group.
  const scored = [...groups.values()].map((group) => {
    const embed = Math.max(...group.map((c) => scores.get(c.printingId) ?? -Infinity));
    const ref = group.find((c) => input.layoutScoreFor(c.printingId) !== null);
    const layout = ref ? input.layoutScoreFor(ref.printingId)! : 0;
    return { group, embed, layout, combined: cfg.EMBED_WEIGHT * embed + cfg.LAYOUT_WEIGHT * layout, ref };
  });
  scored.sort((a, b) => b.combined - a.combined);
  const layoutScores: LayoutScore[] = scored
    .filter((s) => s.ref)
    .map((s) => ({ printingId: s.ref!.printingId, layoutScore: s.layout }));

  const [first, second] = scored;
  const pickIn = (group: Card[]) => pickSamePicture(group, prices, packMode).printingId;
  if (first.combined - second.combined >= cfg.LAYOUT_MARGIN_T) {
    return accept(pickIn(first.group), "layout_resolved", layoutScores);
  }
  return {
    ...base,
    status: "ask",
    best,
    reason: "layout_ambiguous",
    askOptions: [pickIn(first.group), pickIn(second.group)],
    layout: layoutScores,
  };
}

/** Helpers to build the lookup maps once at load. */
export function indexCards(list: readonly Card[]) {
  const cards = new Map(list.map((c) => [c.printingId, c]));
  const byName = new Map<string, Card[]>();
  for (const c of list) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  return { cards, byName };
}

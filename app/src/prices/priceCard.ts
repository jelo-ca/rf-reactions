// Pure logic behind the price card (PLAN.md §7). The component only renders `priceCardView`.
import type { Card, Price, Variant } from "../types";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** "$1,234.50"; "—" for a missing or invalid price (the UI must never crash on one). */
export function formatUsd(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) || v < 0 ? "—" : USD.format(v);
}

/** Snapshot time → "Sep 25, 2026" (UTC, so the date doesn't shift with the viewer's zone); null if unparsable. */
export function formatAsOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : DATE.format(t);
}

const VARIANT_LABELS: Record<Variant, string> = { normal: "Normal", foil: "Foil", alt_art: "Alt art", promo: "Promo" };

export function variantLabel(v: Variant): string {
  return VARIANT_LABELS[v] ?? v;
}

/**
 * Foil printing with the same picture as `card`, if any. Same picture means the camera can't tell
 * them apart and the decision rule shows the cheaper one (§6.4 rule 6), so the card hints at the foil.
 */
export function findFoilSibling(card: Card, cards: readonly Card[]): Card | undefined {
  if (card.variant === "foil") return undefined;
  return cards.find((c) => c.name === card.name && c.imageHash === card.imageHash && c.variant === "foil");
}

export interface PriceCardView {
  imageUrl: string;
  name: string;
  set: string; // "Origins · #001"
  variant: string;
  price: string;
  hasPrice: boolean;
  asOf: string | null;
  foilHint: string | null; // "could be foil: $X"
  nexusNight: boolean;
}

export function priceCardView(card: Card, cards: readonly Card[], prices: ReadonlyMap<string, Price>): PriceCardView {
  const price = prices.get(card.printingId);
  const shown = formatUsd(price?.priceUsd);
  const foil = findFoilSibling(card, cards);
  const foilPrice = foil ? formatUsd(prices.get(foil.printingId)?.priceUsd) : "—";
  return {
    imageUrl: card.imageUrl,
    name: card.name,
    set: `${card.setName || card.setCode} · #${card.collectorNumber}`,
    variant: variantLabel(card.variant),
    price: shown,
    hasPrice: shown !== "—",
    asOf: formatAsOf(price?.asOf),
    foilHint: foil ? (foilPrice === "—" ? "could be foil" : `could be foil: ${foilPrice}`) : null,
    nexusNight: card.pool === "nexus_night",
  };
}

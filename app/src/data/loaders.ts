// Loaders for the static files in public/data (built by scripts/build_data.sh).
import type { Card, Price } from "../types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} - run scripts/build_data.sh`);
  return (await res.json()) as T;
}

export const loadCards = () => getJson<Card[]>("/data/cards.json");
export const loadPrices = () => getJson<Price[]>("/data/prices.json");

/** Case/punctuation-insensitive search over name, printing id and set/number. */
export function searchCards(cards: readonly Card[], query: string, limit = 20): Card[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(" ");
  return cards
    .filter((c) => {
      const hay = normalize(`${c.name} ${c.printingId} ${c.setCode} ${c.collectorNumber} ${c.variant}`);
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

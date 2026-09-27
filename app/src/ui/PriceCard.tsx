// Result card (PLAN.md §7): shown when the reaction starts, kept until the next card replaces it.
import { useMemo } from "react";
import { priceCardView } from "../prices/priceCard";
import type { Card, Price } from "../types";

interface Props {
  card: Card;
  cards: readonly Card[];
  prices: ReadonlyMap<string, Price>;
}

export function PriceCard({ card, cards, prices }: Props) {
  const v = useMemo(() => priceCardView(card, cards, prices), [card, cards, prices]);
  return (
    <section className="price-card" aria-live="polite" aria-label={`${v.name}, ${v.price}`}>
      <img src={v.imageUrl} alt={v.name} width={140} height={196} />
      <div className="price-card-body">
        <h2>{v.name}</h2>
        <div className="price-card-set">{v.set}</div>
        <div className="price-card-badges">
          <span className={`badge badge-${card.variant}`}>{v.variant}</span>
          {v.nexusNight && <span className="badge badge-nexus">Nexus Night</span>}
        </div>
        <div className={v.hasPrice ? "price-card-price" : "price-card-price missing"}>
          {v.hasPrice ? v.price : "No price"}
        </div>
        {v.asOf && <div className="price-card-asof">as of {v.asOf}</div>}
        {v.foilHint && <div className="price-card-hint">{v.foilHint}</div>}
      </div>
    </section>
  );
}

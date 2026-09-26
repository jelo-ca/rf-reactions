// Minimal result display for Phase 3 (the full price card is Phase 4).
import type { Card, RecognitionReason } from "../types";

interface Props {
  card: Card;
  price: number | undefined;
  reason: RecognitionReason | undefined;
  cardsByName: readonly Card[];
  prices: ReadonlyMap<string, number>;
}

const usd = (v: number | undefined) => (v === undefined ? "—" : `$${v.toFixed(2)}`);

export function ResultChip({ card, price, reason, cardsByName, prices }: Props) {
  // Same picture can't be told apart (e.g. foil): show the other finish's price as a hint.
  const foil =
    reason === "same_image_cheapest" && card.variant !== "foil"
      ? cardsByName.find((c) => c.name === card.name && c.imageHash === card.imageHash && c.variant === "foil")
      : undefined;
  return (
    <div className="result-chip">
      <img src={card.imageUrl} alt="" />
      <div>
        <b>{card.name}</b>
        <div className="muted">
          {card.setCode} {card.collectorNumber} · {card.variant.replace("_", " ")}
          {card.pool === "nexus_night" ? " · Nexus Night" : ""}
        </div>
        <div className="price">{usd(price)}</div>
        {foil && <div className="muted">could be foil: {usd(prices.get(foil.printingId))}</div>}
      </div>
    </div>
  );
}

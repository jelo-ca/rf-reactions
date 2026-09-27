// Debug view of the last accepted result (the Phase 3 chip): raw ids + decision reason.
// Shown with the debug panel (D); the user-facing result is PriceCard.
import { formatUsd } from "../prices/priceCard";
import type { Card, RecognitionReason } from "../types";

interface Props {
  card: Card;
  price: number | undefined;
  reason: RecognitionReason | undefined;
  cardsByName: readonly Card[];
  prices: ReadonlyMap<string, number>;
}

export function ResultChip({ card, price, reason, cardsByName, prices }: Props) {
  // Same picture can't be told apart (e.g. foil): show the other finish's price as a hint.
  const foil =
    reason === "same_image_cheapest" && card.variant !== "foil"
      ? cardsByName.find((c) => c.name === card.name && c.imageHash === card.imageHash && c.variant === "foil")
      : undefined;
  return (
    <div className="result-chip" title="Debug: last accepted result">
      <img src={card.imageUrl} alt="" />
      <div>
        <b>{card.name}</b>
        <div className="muted">
          <code>{card.printingId}</code> · {reason ?? "—"}
        </div>
        <div className="muted">
          {card.setCode} {card.collectorNumber} · {card.variant.replace("_", " ")}
          {card.pool === "nexus_night" ? " · Nexus Night" : ""}
        </div>
        <div className="price">{formatUsd(price)}</div>
        {foil && <div className="muted">could be foil: {formatUsd(prices.get(foil.printingId))}</div>}
      </div>
    </div>
  );
}

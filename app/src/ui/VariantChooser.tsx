// "Which one?" chooser (PLAN.md §6.4a): shown when look-alike printings are too close to call.
import { useEffect } from "react";
import type { Card } from "../types";

interface Props {
  options: Card[];
  prices: ReadonlyMap<string, number>;
  onPick: (printingId: string) => void;
}

const usd = (v: number | undefined) => (v === undefined ? "—" : `$${v.toFixed(2)}`);
const label = (c: Card) =>
  `${c.setCode} ${c.collectorNumber} · ${c.variant.replace("_", " ")}${c.pool === "nexus_night" ? " · Nexus Night" : ""}`;

export function VariantChooser({ options, prices, onPick }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < options.length) onPick(options[i].printingId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onPick]);

  return (
    <div className="chooser" role="dialog" aria-label="Which printing is it?">
      <h2>Which one is it?</h2>
      <div className="chooser-options">
        {options.map((c, i) => (
          <button key={c.printingId} type="button" onClick={() => onPick(c.printingId)}>
            <img src={c.imageUrl} alt={c.name} />
            <span className="chooser-key">{i + 1}</span>
            <span>{label(c)}</span>
            <b>{usd(prices.get(c.printingId))}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

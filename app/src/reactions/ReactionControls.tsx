// Small UI pieces for Phase 5: the tier dev panel (T) and "Click to start".
import { useState } from "react";
import type { TierMode } from "./tiers";
import { parseLimits } from "./tierTuning";
import { tierModeLabel } from "./useTierMode";

interface DevProps {
  names: readonly string[];
  mode: TierMode;
  limits: readonly number[]; // price thresholds in effect (tier i = up to limits[i]; last tier open-ended)
  defaults: readonly number[]; // from public/data/tiers.json
  counts: readonly number[]; // booster printings per tier in the current mode
  json: string; // priceTiers block for tiers.json
  onFire: (tier: number) => void;
  onToggleMode: () => void;
  onLimits: (limits: number[] | null) => void; // null = back to tiers.json
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** T: fire any tier on demand, and tune the price thresholds live (PLAN §8). */
export function TierDevPanel({ names, mode, limits, defaults, counts, json, onFire, onToggleMode, onLimits }: DevProps) {
  const [drafts, setDrafts] = useState(() => limits.map(String));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const overridden = limits.some((v, i) => v !== defaults[i]);
  const total = counts.reduce((a, b) => a + b, 0);

  const edit = (i: number, text: string) => {
    const next = drafts.map((d, j) => (j === i ? text : d));
    setDrafts(next);
    const { limits: parsed, error: e } = parseLimits(next);
    setError(e);
    if (parsed) onLimits(parsed); // live: the next reaction uses it
  };
  const reset = () => {
    setDrafts(defaults.map(String));
    setError(null);
    onLimits(null);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="tier-dev" role="group" aria-label="Reaction tiers">
      <div className="tier-dev-head">
        <b>Reaction tiers</b>
        <button type="button" onClick={onToggleMode} title="H">
          {tierModeLabel(mode)}
        </button>
      </div>
      <table>
        <tbody>
          {names.map((n, i) => (
            <tr key={n}>
              <td>
                <button type="button" onClick={() => onFire(i)} title="Fire this tier with a real card from it">
                  ▶ {i} · {n}
                </button>
              </td>
              <td className="range">{i === 0 ? "$0 –" : `> ${usd(limits[i - 1])} –`}</td>
              <td>
                {i < names.length - 1 ? (
                  <input
                    aria-label={`Tier ${i} up to (USD)`}
                    inputMode="decimal"
                    value={drafts[i]}
                    onChange={(e) => edit(i, e.target.value)}
                    className={limits[i] !== defaults[i] ? "changed" : ""}
                  />
                ) : (
                  <span className="muted">and up</span>
                )}
              </td>
              <td className="count" title="Booster printings on this tier">
                {counts[i]} <span className="muted">({total ? Math.round((counts[i] / total) * 100) : 0}%)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mode === "rarity" && <p className="muted">Hype mode: tiers come from rarity; price thresholds apply in price mode.</p>}
      {error && <p className="error-inline">{error}</p>}
      <div className="tier-dev-foot">
        <button type="button" onClick={reset} disabled={!overridden}>
          Reset to tiers.json
        </button>
        <button type="button" onClick={copy} title="priceTiers block to paste into public/data/tiers.json">
          {copied ? "Copied!" : "Copy JSON"}
        </button>
        {overridden && <span className="muted">saved in this browser</span>}
      </div>
    </div>
  );
}

/** Browsers only allow sound after a user gesture, so the app starts with one click. */
export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="start-screen">
      <button type="button" onClick={onStart} autoFocus>
        Click to start
      </button>
      <p>Turns on the camera loop and the (very professional) reaction sounds.</p>
    </div>
  );
}

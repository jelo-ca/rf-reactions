// Reaction overlay above the video (PLAN.md §8.2), comedic tiers (owner, 2026-09-27):
// 0 golf clap · 1 participation trophy · 2 sitcom "OHHH" · 3 instant replay · 4 air horn · 5 over-edited epic.
// Each tier = one small component + CSS keyframes; stage shakes/confetti live in fx.ts, sounds in sounds.ts.
import { useEffect, useState } from "react";
import "./reactions.css";
import { CFG } from "../config";
import { formatUsd } from "../prices/priceCard";
import type { Card } from "../types";
import { countUp } from "./helpers";

export interface Reaction {
  id: number; // bumps on every fire, so the same card twice still replays
  tier: number;
  card: Card;
  priceUsd: number | undefined;
}

interface Props {
  reaction: Reaction | null;
  onDismiss: () => void;
}

export function ReactionLayer({ reaction, onDismiss }: Props) {
  // Tiers 0–4 remove themselves when done; tier 5 settles into a small persistent state.
  const [settledId, setSettledId] = useState<number | null>(null);
  const [doneId, setDoneId] = useState<number | null>(null);

  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => {
      if (reaction.tier >= 5) setSettledId(reaction.id);
      else setDoneId(reaction.id);
    }, CFG.REACTION_MS[reaction.tier] ?? 2000);
    return () => clearTimeout(t);
  }, [reaction]);

  if (!reaction || doneId === reaction.id) return null;
  const price = formatUsd(reaction.priceUsd);
  const settled = settledId === reaction.id;
  const Tier = TIERS[reaction.tier] ?? GolfClap;
  return (
    <div className={`reaction-layer tier-${reaction.tier}${settled ? " settled" : ""}`} aria-hidden="true">
      {settled ? (
        <button type="button" className="epic-settled" onClick={onDismiss} title="Dismiss">
          ★ LEGENDARY PULL ★ <span>{price}</span>
        </button>
      ) : (
        <Tier key={reaction.id} card={reaction.card} price={price} priceUsd={reaction.priceUsd} />
      )}
    </div>
  );
}

interface TierProps {
  card: Card;
  price: string;
  priceUsd: number | undefined;
}

function GolfClap({ price }: TierProps) {
  return (
    <div className="fx-golf">
      <div className="claps">
        <span>👏</span>
        <span>👏</span>
        <span>👏</span>
      </div>
      <div className="meh">nice. {price}.</div>
    </div>
  );
}

function Trophy({ price }: TierProps) {
  return (
    <div className="fx-trophy">
      <div className="trophy">🏆</div>
      <div className="ribbon">you tried!</div>
      <div className="small">{price} · participation award</div>
    </div>
  );
}

function Sitcom({ price }: TierProps) {
  return (
    <>
      <div className="fx-sitcom-price">{price}</div>
      <div className="fx-sitcom">[STUDIO AUDIENCE: OHHHHHH]</div>
    </>
  );
}

function Replay({ card, price }: TierProps) {
  return (
    <div className="fx-replay">
      <div className="replay-tag">● REPLAY</div>
      <div className="replay-banner">
        <span>INSTANT REPLAY</span>
      </div>
      <div className="replay-lower">
        <b>{card.name}</b> <span>{price}</span>
      </div>
    </div>
  );
}

const HITMARKERS: [number, number][] = [[22, 30], [70, 24], [35, 68], [78, 62], [52, 44], [15, 52]];

function AirHorn({ price }: TierProps) {
  return (
    <div className="fx-airhorn">
      <div className="flames" />
      {HITMARKERS.map(([x, y], i) => (
        <span key={i} className="hitmarker" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 110}ms` }}>
          ✕
        </span>
      ))}
      <div className="mlg">SHEEEESH</div>
      <div className="mlg-price">{price}</div>
      <div className="mlg-plus">+1000</div>
    </div>
  );
}

function Epic({ card, price, priceUsd }: TierProps) {
  const shown = useCountUp(priceUsd, CFG.EPIC_IMPACT_MS, CFG.EPIC_COUNT_MS);
  return (
    <div className="fx-epic" style={{ "--hit": `${CFG.EPIC_IMPACT_MS}ms` } as React.CSSProperties}>
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      <div className="spotlight" />
      <div className="teaser">wait for it…</div>
      <img className="epic-card" src={card.imageUrl} alt="" />
      <div className="flash" />
      <div className="flare" />
      <div className="fry" />
      <div className="epic-title" data-text="LEGENDARY PULL">LEGENDARY PULL</div>
      <div className="epic-price">{priceUsd === undefined ? price : formatUsd(shown)}</div>
      <div className="epic-name">{card.name}</div>
      <div className="watermark">MLG PRO EDIT™ · 4K 60FPS HDR · made in Windows Movie Maker</div>
    </div>
  );
}

/** Tier 5 price: $0 until the impact, then counts up (pure math in helpers.countUp). */
function useCountUp(target: number | undefined, delayMs: number, durationMs: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === undefined) return;
    const start = performance.now() + delayMs;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      setV(now < start ? 0 : countUp(target, now - start, durationMs));
      if (now < start + durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs]);
  return v;
}

const TIERS = [GolfClap, Trophy, Sitcom, Replay, AirHorn, Epic];

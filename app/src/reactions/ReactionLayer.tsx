// Reaction overlay above the video (PLAN.md §8.2), tiers reworked by the owner (2026-09-28):
// 0 golf clap · 1 crowd "OOOOH" · 2 Michael Rosen's "*click* Nice" (owner, 2026-09-28) · 3 classic air horns ·
// 4 soyjak air horns (longer, memier; settles into a gold banner until the next card).
// Each tier = one small component + CSS keyframes; stage shakes/confetti live in fx.ts, sounds in sounds.ts.
import { useEffect, useRef, useState } from "react";
import "./reactions.css";
import { assetUrl } from "../assetUrl";
import { CFG } from "../config";
import { NICE_AT_MS } from "./fx";
import { formatUsd } from "../prices/priceCard";
import type { Card } from "../types";
import { countUp } from "./helpers";
import { Soyjak } from "./Soyjak";

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
  // Lower tiers remove themselves when done; the top tier settles into a small persistent state.
  const [settledId, setSettledId] = useState<number | null>(null);
  const [doneId, setDoneId] = useState<number | null>(null);

  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => {
      if (reaction.tier >= TOP) setSettledId(reaction.id);
      else setDoneId(reaction.id);
    }, CFG.REACTION_MS[reaction.tier] ?? 2000);
    return () => clearTimeout(t);
  }, [reaction]);

  if (!reaction || doneId === reaction.id) return null;
  const price = formatUsd(reaction.priceUsd);
  const settled = settledId === reaction.id;
  const Tier = TIERS[Math.min(reaction.tier, TOP)] ?? GolfClap;
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

/** 0 — a few people politely clapping on a golf course. */
function GolfClap({ price }: TierProps) {
  return (
    <div className="fx-golf">
      <div className="claps">
        <span>👏</span>
        <span>👏</span>
        <span>👏</span>
      </div>
      <div className="golf-caption">(polite golf applause)</div>
      <div className="meh">⛳ nice. {price}.</div>
    </div>
  );
}

/** 1 — the whole room goes "OOOOOH". */
function CrowdOoh({ price }: TierProps) {
  return (
    <>
      <div className="fx-ooh-price">{price}</div>
      <div className="fx-ooh">
        <span>O</span>
        <span>O</span>
        <span>O</span>
        <span>O</span>
        <span>O</span>
        <span>H</span>
      </div>
      <div className="fx-ooh-caption">[crowd: oooooh]</div>
    </>
  );
}

/** The GIF's own "nice" (mouth opens) is ~0.55 s in; start it this late so it lines up with the audio. */
const NICE_GIF_DELAY_MS = NICE_AT_MS - 550;

/** 2 — Michael Rosen: *click* … "Nice" (the GIF, ending in the face-bulge "nooice"). */
function RosenNice({ card, price }: TierProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const t = setTimeout(() => void ref.current?.play().catch(() => {}), NICE_GIF_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="fx-nice" style={{ "--nice": `${NICE_AT_MS}ms` } as React.CSSProperties}>
      {/* holds the first frame (hand at mouth, the *click*) until it plays, then the last (bulge) */}
      <video ref={ref} className="rosen" src={assetUrl("/memes/rosen-nice.webm")} muted playsInline preload="auto" />
      <div className="nice-text">NICE</div>
      <div className="nice-lower">
        <b>{card.name}</b> <span>{price}</span>
      </div>
    </div>
  );
}

const HITMARKERS: [number, number][] = [[22, 30], [70, 24], [35, 68], [78, 62], [52, 44], [15, 52]];

/** 3 — classic air horns. */
function AirHorn({ price }: TierProps) {
  return (
    <div className="fx-airhorn">
      <div className="flames" />
      {HITMARKERS.map(([x, y], i) => (
        <span key={i} className="hitmarker" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 110}ms` }}>
          ✕
        </span>
      ))}
      <div className="mlg">📯 BWAAAA 📯</div>
      <div className="mlg-price">{price}</div>
      <div className="mlg-plus">+1000</div>
    </div>
  );
}

/** 4 — soyjak air horns: build-up, then at EPIC_IMPACT_MS the drop and everything at once. */
function SoyEpic({ card, price, priceUsd }: TierProps) {
  const shown = useCountUp(priceUsd, CFG.EPIC_IMPACT_MS, CFG.EPIC_COUNT_MS);
  return (
    <div className="fx-soy" style={{ "--hit": `${CFG.EPIC_IMPACT_MS}ms` } as React.CSSProperties}>
      <div className="spotlight" />
      <div className="flames" />
      <img className="soy-card" src={card.imageUrl} alt="" />
      <Soyjak variant="glasses" className="soyjak left" />
      <Soyjak variant="pointing" className="soyjak right" />
      <div className="soy-pre">NO WAY</div>
      <div className="flash" />
      <div className="fry" />
      {HITMARKERS.map(([x, y], i) => (
        <span key={i} className="hitmarker" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `calc(var(--hit) + ${i * 140}ms)` }}>
          ✕
        </span>
      ))}
      <div className="soy-title" data-text="IS THIS IRL?!">IS THIS IRL?!</div>
      <div className="soy-bubble left">OMG</div>
      <div className="soy-bubble right">IS THAT A {card.name.split(" - ")[0].toUpperCase()}?!</div>
      <div className="soy-price">{priceUsd === undefined ? price : formatUsd(shown)}</div>
      <div className="watermark">MLG PRO EDIT™ · 4K 60FPS HDR · made in Windows Movie Maker</div>
    </div>
  );
}

/** Top tier price: $0 until the impact, then counts up (pure math in helpers.countUp). */
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

const TIERS = [GolfClap, CrowdOoh, RosenNice, AirHorn, SoyEpic];
const TOP = TIERS.length - 1;

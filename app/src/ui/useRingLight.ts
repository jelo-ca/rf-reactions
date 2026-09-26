import { useCallback, useState } from "react";

// Screen "ring light": a bright frame around the video that lights the card from the display.
// Per-viewer convenience, remembered in localStorage (storage may be unavailable).
const KEY = "riftpulls.ringLight";
export type RingLight = "off" | "neutral" | "warm";
const ORDER: RingLight[] = ["off", "neutral", "warm"];

function load(): RingLight {
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.includes(v as RingLight) ? (v as RingLight) : "off";
  } catch {
    return "off";
  }
}

export function useRingLight() {
  const [ring, setRing] = useState<RingLight>(load);
  const cycle = useCallback(() => {
    setRing((r) => {
      const next = ORDER[(ORDER.indexOf(r) + 1) % ORDER.length];
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* not remembered */
      }
      return next;
    });
  }, []);
  return { ring, cycleRing: cycle };
}

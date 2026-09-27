import { useCallback, useState } from "react";

// Screen "ring light": when on, the page turns into a bright white frame around the (inset) video,
// lighting the card from the display. On/off, remembered per viewer (storage may be unavailable).
const KEY = "riftpulls.ringLight";

function load(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "neutral" || v === "warm"; // earlier versions stored a colour
  } catch {
    return false;
  }
}

export function useRingLight() {
  const [ring, setRing] = useState<boolean>(load);
  const toggle = useCallback(() => {
    setRing((on) => {
      try {
        localStorage.setItem(KEY, on ? "off" : "on");
      } catch {
        /* not remembered */
      }
      return !on;
    });
  }, []);
  return { ring, toggleRing: toggle };
}

import { useCallback, useState } from "react";
import { CFG } from "../config";
import type { PackMode } from "../types";
import { loadPackMode, nextPackMode, savePackMode } from "../vision/packMode";

/**
 * Pack mode setting (PLAN.md §6.4b), remembered per viewer in localStorage.
 * With CFG.NEXUS_NIGHT_ENABLED off it is always "booster" and the toggle does nothing
 * (a saved "nexus_night" is kept for when the feature returns).
 */
const noop = () => {};

export function usePackMode() {
  const [mode, setMode] = useState<PackMode>(() => loadPackMode());
  const toggle = useCallback(() => {
    setMode((m) => {
      const next = nextPackMode(m);
      savePackMode(next);
      return next;
    });
  }, []);
  if (!CFG.NEXUS_NIGHT_ENABLED) return { packMode: "booster" as PackMode, togglePackMode: noop, packModeEnabled: false };
  return { packMode: mode, togglePackMode: toggle, packModeEnabled: true };
}

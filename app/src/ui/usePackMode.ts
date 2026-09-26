import { useCallback, useState } from "react";
import type { PackMode } from "../types";
import { loadPackMode, nextPackMode, savePackMode } from "../vision/packMode";

/** Pack mode setting (PLAN.md §6.4b), remembered per viewer in localStorage. */
export function usePackMode() {
  const [mode, setMode] = useState<PackMode>(() => loadPackMode());
  const toggle = useCallback(() => {
    setMode((m) => {
      const next = nextPackMode(m);
      savePackMode(next);
      return next;
    });
  }, []);
  return { packMode: mode, togglePackMode: toggle };
}

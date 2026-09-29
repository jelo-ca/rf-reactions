// Keyboard shortcuts, listed in the ? overlay (PLAN.md §10.2). Handlers live in App.tsx.
export interface Shortcut {
  key: string;
  what: string;
  packModeOnly?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: "?", what: "Show / hide this list" },
  { key: "D", what: "Debug panel (timings, scores, export session)" },
  { key: "B", what: "Rescan the current view" },
  { key: "H", what: "Hype mode: react by rarity instead of price" },
  { key: "T", what: "Tier panel: fire any reaction, tune price thresholds" },
  { key: "L", what: "Ring light" },
  { key: "M", what: "Mirror the camera" },
  { key: "C", what: "Capture mode (eval / detector photos)" },
  { key: "N", what: "Pack mode: booster / Nexus Night", packModeOnly: true },
];

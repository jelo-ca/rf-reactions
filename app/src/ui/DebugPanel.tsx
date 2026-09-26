import { CFG } from "../config";
import type { StabilityStats } from "../stability/useStability";
import type { PackMode } from "../types";

interface Props {
  stats: StabilityStats;
  packMode: PackMode;
  videoSize: { w: number; h: number };
}

const fmt = (v: number | null, digits = 1) => (v === null ? "—" : v.toFixed(digits));

export function DebugPanel({ stats, packMode, videoSize }: Props) {
  const { state, signals } = stats;
  const rows: [string, string, boolean?][] = [
    ["state", state.phase],
    ["presence", `${fmt(signals.presence)} / ${CFG.PRESENT_T}`, signals.presence > CFG.PRESENT_T],
    ["motion", `${fmt(signals.motion)} / ${CFG.MOTION_T}`, signals.motion < CFG.MOTION_T],
    ["sharpness", `${fmt(signals.sharpness, 0)} / ${CFG.SHARP_T}`, (signals.sharpness ?? 0) > CFG.SHARP_T],
    ["stable frames", `${state.stableFrames} / ${CFG.STABLE_FRAMES}`],
    ["empty frames", `${state.emptyFrames} / ${CFG.EMPTY_FRAMES}`],
    ["retries", `${state.retries} / ${CFG.RETRIES}`],
    ["still → recognize", stats.lastStableToRecognizeMs === null ? "—" : `${stats.lastStableToRecognizeMs.toFixed(0)} ms`],
    ["last effect", stats.lastEffect ?? "—"],
    ["reactions", String(stats.reactions)],
    ["background", stats.hasBackground ? "captured" : "waiting…"],
    ["pack mode", packMode],
    ["fps", String(stats.fps)],
    ["video", `${videoSize.w}×${videoSize.h}`],
  ];
  return (
    <aside className="debug" aria-label="Debug panel">
      <h2>Debug</h2>
      <dl>
        {rows.map(([k, v, ok]) => (
          <div key={k} className={ok === undefined ? "" : ok ? "ok" : "off"}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

import { CFG } from "../config";
import type { Summary } from "../metrics/rolling";
import type { StabilityStats } from "../stability/useStability";
import type { Card, PackMode } from "../types";
import type { RecognizerState } from "../vision/useRecognizer";
import type { DetectorInfo } from "../vision/worker";

interface Props {
  stats: StabilityStats;
  packMode: PackMode;
  videoSize: { w: number; h: number };
  rec: RecognizerState;
  detector: DetectorInfo | null;
  cardById: ReadonlyMap<string, Card>;
  prices: ReadonlyMap<string, number>;
}

const fmt = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : v.toFixed(digits));
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(0)} ms`);
const pct = (s: Summary | undefined) => (s ? `${ms(s.p50)} / ${ms(s.p95)} (n=${s.n})` : "—");

export function DebugPanel({ stats, packMode, videoSize, rec, detector, cardById, prices }: Props) {
  const { state, signals } = stats;
  const last = rec.last;
  const rows: [string, string, boolean?][] = [
    ["state", state.phase],
    ["change", `${fmt(signals.change)} / ${CFG.CHANGE_T}`, signals.change > CFG.CHANGE_T],
    ["motion", `${fmt(signals.motion)} / ${CFG.MOTION_T}`, signals.motion < CFG.MOTION_T],
    ["sharpness", `${fmt(signals.sharpness, 0)} / ${CFG.SHARP_T}`, (signals.sharpness ?? 0) > CFG.SHARP_T],
    ["stable frames", `${state.stableFrames}/${CFG.STABLE_FRAMES}`],
    ["retries", `${state.retries} / ${CFG.RETRIES}`],
    ["still → recognize", ms(stats.lastStableToRecognizeMs)],
    ["still → result", ms(stats.lastStillToResultMs), (stats.lastStillToResultMs ?? Infinity) < 300],
    ["camera", stats.ready ? `ready · last: ${state.outcome}` : "warming up…"],
    ["pack mode", packMode],
    [
      "detector",
      !detector ? "loading…" : detector.available ? `${detector.backend} · ${ms(detector.loadMs)} load` : "off (no model)",
    ],
    [
      "watching",
      `${stats.detection.source === "detector" ? "detected card" : "guide box"}${stats.detection.present === null ? "" : ` · p=${stats.detection.present.toFixed(2)}`} · ${ms(stats.detection.ms)}`,
      stats.detection.source === "detector",
    ],
    ["last crop", last ? last.source : "—"],
    ["backend", rec.info ? `${rec.info.backend} · ${rec.info.threads}t` : "loading…"],
    ["load / warm-up", rec.info ? `${ms(rec.info.loadMs)} / ${ms(rec.info.warmupMs)}` : "—"],
    ["fps · video", `${stats.fps} · ${videoSize.w}×${videoSize.h}`],
    ["reactions · asks", `${stats.reactions} · ${rec.asks}`],
  ];
  const name = (id: string) => cardById.get(id)?.name ?? id;
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
      {last && (
        <>
          <h2>Last result</h2>
          <dl>
            <div className={last.status === "accepted" ? "ok" : last.status === "rejected" ? "bad" : ""}>
              <dt>status</dt>
              <dd>{last.status} · {last.reason ?? "—"}</dd>
            </div>
            {last.best && (
              <div>
                <dt>best</dt>
                <dd>{last.best.printingId} ${fmt(prices.get(last.best.printingId), 2)}</dd>
              </div>
            )}
            <div><dt>crop / prep</dt><dd>{ms(last.cropMs)} / {ms(last.timings.prepMs)}</dd></div>
            <div><dt>infer / search</dt><dd>{ms(last.timings.inferMs)} / {ms(last.timings.searchMs)}</dd></div>
            <div><dt>layout · total</dt><dd>{ms(last.timings.layoutMs)} · {ms(last.totalMs)}</dd></div>
          </dl>
          <ol className="top">
            {last.top.map((m) => (
              <li key={m.printingId}>
                <span>{m.printingId} {name(m.printingId)}</span>
                <span>{m.score.toFixed(3)}</span>
              </li>
            ))}
          </ol>
          {last.layout && (
            <ol className="top">
              {last.layout.map((l) => (
                <li key={l.printingId}><span>layout {l.printingId}</span><span>{l.layoutScore.toFixed(3)}</span></li>
              ))}
            </ol>
          )}
          <h2>p50 / p95</h2>
          <dl>
            {["crop+recognize", "infer", "search", "layout"].map((k) => (
              <div key={k}><dt>{k}</dt><dd>{pct(rec.summary[k])}</dd></div>
            ))}
          </dl>
        </>
      )}
    </aside>
  );
}

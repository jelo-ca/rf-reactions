// Session log (PLAN.md §10.1): one record per recognition, the reaction start attached to the record
// that caused it, rolling p50/p95 and a JSON export. Pure; unit tested.
import { type Summary, summarize } from "./rolling";

export interface Pull {
  at: string; // ISO wall-clock time of the result
  status: "accepted" | "rejected" | "ask";
  reason: string | null;
  printingId: string | null; // best match (accepted, or top guess otherwise)
  score: number | null;
  source: "detector" | "guide";
  packMode: string;
  stillToRecognizeMs: number; // first still frame → recognition starts
  stillToResultMs: number; // first still frame → result (the headline number)
  cropMs: number;
  prepMs: number;
  inferMs: number;
  searchMs: number; // includes the decision (thresholds / margin) in the worker
  layoutMs: number;
  totalMs: number; // crop + everything in the worker, main-thread view
  /** First still frame → reaction started (sound + overlay). null = no reaction (rejected, repeat). */
  stillToReactionMs: number | null;
  tier: number | null;
  viaChooser: boolean; // reaction waited for a human pick, so it's not a latency sample
}

/** Timing keys summarized in the debug panel and the export. */
export const PULL_TIMINGS = [
  "stillToResultMs", "stillToReactionMs", "stillToRecognizeMs", "cropMs", "prepMs", "inferMs", "searchMs", "layoutMs", "totalMs",
] as const;
type TimingKey = (typeof PULL_TIMINGS)[number];

export class SessionLog {
  readonly pulls: Pull[] = [];

  add(p: Pull): void {
    this.pulls.push(p);
  }

  /**
   * The reaction for `printingId` started `stillToReactionMs` after its first still frame: attach it
   * to the latest record of that printing that has no reaction yet (accepted or picked in the chooser).
   */
  reacted(printingId: string, tier: number, stillToReactionMs: number, viaChooser: boolean): void {
    for (let i = this.pulls.length - 1; i >= 0; i--) {
      const p = this.pulls[i];
      if (p.stillToReactionMs !== null) return; // only the latest recognition can react
      if (p.status === "rejected") continue;
      if (viaChooser && p.status === "ask") p.printingId = printingId;
      if (p.printingId !== printingId) return;
      Object.assign(p, { stillToReactionMs, tier, viaChooser });
      return;
    }
  }

  /** p50/p95 per timing. Latency (still → *) only counts pulls that were not waiting on the chooser. */
  summary(): Record<TimingKey, Summary> {
    const auto = this.pulls.filter((p) => !p.viaChooser);
    const out = {} as Record<TimingKey, Summary>;
    for (const k of PULL_TIMINGS) {
      const src = k.startsWith("still") ? auto : this.pulls;
      out[k] = summarize(src.map((p) => p[k]).filter((v): v is number => v !== null));
    }
    return out;
  }

  counts() {
    const by = (s: Pull["status"]) => this.pulls.filter((p) => p.status === s).length;
    return {
      pulls: this.pulls.length,
      accepted: by("accepted"),
      asked: by("ask"),
      rejected: by("rejected"),
      reactions: this.pulls.filter((p) => p.stillToReactionMs !== null).length,
    };
  }

  /** Everything needed to write the NOTES.md summary for one real session. */
  toExport<M extends object>(meta: M) {
    return { exportedAt: new Date().toISOString(), ...meta, counts: this.counts(), summary: this.summary(), pulls: this.pulls };
  }
}

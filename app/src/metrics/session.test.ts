import { describe, expect, it } from "vitest";
import { type Pull, SessionLog } from "./session";

const pull = (extra: Partial<Pull> = {}): Pull => ({
  at: "2026-09-28T00:00:00.000Z", status: "accepted", reason: null, printingId: "OGN-001", score: 0.8,
  source: "detector", packMode: "booster", stillToRecognizeMs: 120, stillToResultMs: 200, cropMs: 5, prepMs: 3,
  inferMs: 40, searchMs: 2, layoutMs: 0, totalMs: 60, stillToReactionMs: null, tier: null, viaChooser: false,
  ...extra,
});

describe("SessionLog.reacted", () => {
  it("attaches the reaction to the latest matching pull", () => {
    const log = new SessionLog();
    log.add(pull({ printingId: "A" }));
    log.add(pull({ printingId: "B" }));
    log.reacted("B", 3, 210, false);
    expect(log.pulls[1]).toMatchObject({ stillToReactionMs: 210, tier: 3, viaChooser: false });
    expect(log.pulls[0].stillToReactionMs).toBeNull();
  });

  it("skips a rejected retry but never reaches back past a pull that already reacted", () => {
    const log = new SessionLog();
    log.add(pull({ printingId: "A" }));
    log.reacted("A", 1, 250, false);
    log.add(pull({ status: "rejected", printingId: "A" }));
    log.reacted("A", 1, 999, false); // no new accepted pull → nothing to attach to
    expect(log.pulls[0].stillToReactionMs).toBe(250);
    expect(log.pulls[1].stillToReactionMs).toBeNull();
  });

  it("a chooser pick fills in the printing of the ask", () => {
    const log = new SessionLog();
    log.add(pull({ status: "ask", printingId: "A" }));
    log.reacted("A-foil", 2, 3000, true);
    expect(log.pulls[0]).toMatchObject({ printingId: "A-foil", viaChooser: true, stillToReactionMs: 3000 });
  });

  it("ignores a reaction for a different card", () => {
    const log = new SessionLog();
    log.add(pull({ printingId: "A" }));
    log.reacted("B", 0, 100, false);
    expect(log.pulls[0].stillToReactionMs).toBeNull();
  });
});

describe("SessionLog.summary", () => {
  it("leaves chooser waits out of the latency numbers but keeps their model timings", () => {
    const log = new SessionLog();
    log.add(pull({ stillToResultMs: 100, inferMs: 10 }));
    log.add(pull({ stillToResultMs: 5000, inferMs: 20, status: "ask", viaChooser: true }));
    const s = log.summary();
    expect(s.stillToResultMs).toEqual({ n: 1, p50: 100, p95: 100 });
    expect(s.inferMs.n).toBe(2);
    expect(s.stillToReactionMs.n).toBe(0); // no reaction attached yet
  });

  it("counts statuses and reactions in the export", () => {
    const log = new SessionLog();
    log.add(pull());
    log.reacted("OGN-001", 0, 220, false);
    log.add(pull({ status: "rejected" }));
    const e = log.toExport({ backend: "webgpu" });
    expect(e.backend).toBe("webgpu");
    expect(e.counts).toEqual({ pulls: 2, accepted: 1, asked: 0, rejected: 1, reactions: 1 });
    expect(e.pulls).toHaveLength(2);
  });
});

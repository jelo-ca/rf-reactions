import { describe, expect, it } from "vitest";
import { type Effect, type FrameSignals, type MachineState, initialState, step, wantsSharpness } from "./machine";

const cfg = { CHANGE_T: 12, MOTION_T: 4, STABLE_FRAMES: 3, SHARP_T: 60, RETRIES: 2 };

const UNCHECKED: FrameSignals = { change: 255, motion: 1, sharpness: 200 }; // nothing checked yet
const MOVING: FrameSignals = { change: 40, motion: 20, sharpness: null };
const NEW_STILL: FrameSignals = { change: 40, motion: 1, sharpness: 200 }; // a different view, held still
const NEW_BLURRY: FrameSignals = { change: 40, motion: 1, sharpness: 10 };
const SAME_STILL: FrameSignals = { change: 2, motion: 1, sharpness: 200 }; // the view already checked

function run(frames: FrameSignals[], from: MachineState = initialState) {
  let s = from;
  const effects: Effect[] = [];
  for (const f of frames) {
    const r = step(s, { type: "frame", signals: f }, cfg);
    s = r.state;
    effects.push(r.effect);
  }
  return { s, effects };
}
const times = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);
const recognizing = () => run([MOVING, NEW_STILL, NEW_STILL, NEW_STILL]).s;

describe("change-based state machine", () => {
  it("checks the very first view once it is still (no background needed)", () => {
    const { s, effects } = run([UNCHECKED, UNCHECKED, UNCHECKED, UNCHECKED]);
    expect(s.phase).toBe("RECOGNIZING");
    expect(effects.filter((e) => e === "recognize")).toHaveLength(1);
  });

  it("a changed view held still + sharp → RECOGNIZING, emitting recognize once", () => {
    const { s, effects } = run([MOVING, NEW_STILL, NEW_STILL, NEW_STILL]);
    expect(s.phase).toBe("RECOGNIZING");
    expect(effects.at(-1)).toBe("recognize");
  });

  it("waits while blurry or moving", () => {
    expect(run([MOVING, NEW_BLURRY, NEW_BLURRY, NEW_BLURRY, NEW_BLURRY]).s.phase).toBe("CANDIDATE");
    expect(run([MOVING, NEW_STILL, NEW_STILL, MOVING, NEW_STILL]).s.stableFrames).toBe(1);
  });

  it("returns to IDLE when the view settles back to the already-checked one (a hand passed by)", () => {
    expect(run([MOVING, SAME_STILL, SAME_STILL, SAME_STILL]).s.phase).toBe("IDLE");
  });

  it("small changes (noise, breathing, exposure drift) don't wake it up", () => {
    const { s, effects } = run(times(50, SAME_STILL));
    expect(s.phase).toBe("IDLE");
    expect(effects.every((e) => e === null)).toBe(true);
  });

  it("accepted → react once; holding the same card still never re-triggers", () => {
    const r = step(recognizing(), { type: "result", status: "accepted" }, cfg);
    expect(r.effect).toBe("react");
    expect(r.state).toMatchObject({ phase: "COOLDOWN", outcome: "accepted" });
    const held = run(times(60, SAME_STILL), r.state);
    expect(held.s.phase).toBe("COOLDOWN");
    expect(held.effects.every((e) => e === null)).toBe(true);
  });

  it("removing or swapping the card leaves COOLDOWN on its own (no B needed)", () => {
    const cool = step(recognizing(), { type: "result", status: "accepted" }, cfg).state;
    const { s, effects } = run([MOVING, NEW_STILL, NEW_STILL, NEW_STILL], cool);
    expect(s.phase).toBe("RECOGNIZING");
    expect(effects.at(-1)).toBe("recognize");
  });

  it("rejected → retries the same view up to RETRIES, then COOLDOWN 'unsure'", () => {
    let s = recognizing();
    for (let i = 1; i <= cfg.RETRIES; i++) {
      s = step(s, { type: "result", status: "rejected" }, cfg).state;
      expect(s).toMatchObject({ phase: "CANDIDATE", retries: i });
      s = run([SAME_STILL, SAME_STILL, SAME_STILL], s).s; // same view: retry anyway
      expect(s.phase).toBe("RECOGNIZING");
    }
    s = step(s, { type: "result", status: "rejected" }, cfg).state;
    expect(s).toMatchObject({ phase: "COOLDOWN", outcome: "unsure" });
    expect(run(times(30, SAME_STILL), s).s.phase).toBe("COOLDOWN");
  });

  it("ignores frames while RECOGNIZING and stale results elsewhere", () => {
    const r = run(times(20, MOVING), recognizing());
    expect(r.s.phase).toBe("RECOGNIZING");
    expect(step(initialState, { type: "result", status: "accepted" }, cfg).effect).toBeNull();
  });

  it("ask → ASKING; picking fires the reaction once", () => {
    const asked = step(recognizing(), { type: "result", status: "ask" }, cfg);
    expect(asked.effect).toBe("ask");
    const picked = step(asked.state, { type: "picked" }, cfg);
    expect(picked.effect).toBe("react");
    expect(picked.state.phase).toBe("COOLDOWN");
    expect(step(picked.state, { type: "picked" }, cfg).effect).toBeNull();
  });

  it("wantsSharpness only when the next still frame could trigger recognition", () => {
    const cand: MachineState = { ...initialState, phase: "CANDIDATE", stableFrames: 2 };
    expect(wantsSharpness(cand, 1, cfg)).toBe(true);
    expect(wantsSharpness({ ...cand, stableFrames: 0 }, 1, cfg)).toBe(false);
    expect(wantsSharpness(cand, 10, cfg)).toBe(false);
    expect(wantsSharpness(initialState, 1, cfg)).toBe(false);
  });
});

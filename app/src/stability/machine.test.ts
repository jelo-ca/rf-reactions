import { describe, expect, it } from "vitest";
import { type Effect, type FrameSignals, type MachineState, initialState, step, wantsSharpness } from "./machine";

const cfg = { PRESENT_T: 18, MOTION_T: 4, STABLE_FRAMES: 3, SHARP_T: 60, EMPTY_FRAMES: 10, RETRIES: 2 };

const EMPTY: FrameSignals = { presence: 2, motion: 1, sharpness: null };
const MOVING: FrameSignals = { presence: 40, motion: 20, sharpness: null };
const STILL: FrameSignals = { presence: 40, motion: 1, sharpness: 200 };
const STILL_BLURRY: FrameSignals = { presence: 40, motion: 1, sharpness: 10 };

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

describe("state machine", () => {
  it("IDLE → CANDIDATE when something enters the box", () => {
    expect(run([MOVING]).s.phase).toBe("CANDIDATE");
    expect(run([EMPTY]).s.phase).toBe("IDLE");
  });

  it("CANDIDATE → RECOGNIZING after STABLE_FRAMES still + sharp frames, emitting recognize once", () => {
    const { s, effects } = run([MOVING, STILL, STILL, STILL]);
    expect(s.phase).toBe("RECOGNIZING");
    expect(effects.filter((e) => e === "recognize")).toHaveLength(1);
    expect(effects.at(-1)).toBe("recognize");
  });

  it("does not recognize while blurry, and motion resets the stable count", () => {
    expect(run([MOVING, STILL_BLURRY, STILL_BLURRY, STILL_BLURRY, STILL_BLURRY]).s.phase).toBe("CANDIDATE");
    const r = run([MOVING, STILL, STILL, MOVING, STILL, STILL]);
    expect(r.s.phase).toBe("CANDIDATE");
    expect(r.s.stableFrames).toBe(2);
  });

  it("CANDIDATE → IDLE after EMPTY_FRAMES empty frames", () => {
    expect(run([MOVING, ...times(9, EMPTY)]).s.phase).toBe("CANDIDATE");
    expect(run([MOVING, ...times(10, EMPTY)]).s.phase).toBe("IDLE");
  });

  it("ignores frames while RECOGNIZING (one recognition in flight)", () => {
    const { s } = run([MOVING, STILL, STILL, STILL]);
    const r = run([STILL, STILL, ...times(20, EMPTY)], s);
    expect(r.s.phase).toBe("RECOGNIZING");
    expect(r.effects.every((e) => e === null)).toBe(true);
  });

  it("accepted → react once, then COOLDOWN; no second reaction for the same hold", () => {
    const rec = run([MOVING, STILL, STILL, STILL]).s;
    const r = step(rec, { type: "result", status: "accepted" }, cfg);
    expect(r.effect).toBe("react");
    expect(r.state.phase).toBe("COOLDOWN");
    const held = run(times(50, STILL), r.state);
    expect(held.s.phase).toBe("COOLDOWN");
    expect(held.effects.every((e) => e === null)).toBe(true);
    expect(step(held.s, { type: "result", status: "accepted" }, cfg).effect).toBeNull(); // stale result
  });

  it("COOLDOWN → IDLE only after the card is removed for EMPTY_FRAMES", () => {
    const cool: MachineState = { ...initialState, phase: "COOLDOWN" };
    expect(run([...times(9, EMPTY), STILL, ...times(9, EMPTY)], cool).s.phase).toBe("COOLDOWN");
    expect(run(times(10, EMPTY), cool).s.phase).toBe("IDLE");
  });

  it("rejected → retry as CANDIDATE, then COOLDOWN after RETRIES", () => {
    let s = run([MOVING, STILL, STILL, STILL]).s;
    for (let i = 1; i <= cfg.RETRIES; i++) {
      s = step(s, { type: "result", status: "rejected" }, cfg).state;
      expect(s.phase).toBe("CANDIDATE");
      expect(s.retries).toBe(i);
      s = run([STILL, STILL, STILL], s).s;
      expect(s.phase).toBe("RECOGNIZING");
    }
    s = step(s, { type: "result", status: "rejected" }, cfg).state;
    expect(s.phase).toBe("COOLDOWN");
  });

  it("ask → ASKING; picking fires the reaction once", () => {
    const rec = run([MOVING, STILL, STILL, STILL]).s;
    const asked = step(rec, { type: "result", status: "ask" }, cfg);
    expect(asked.effect).toBe("ask");
    expect(asked.state.phase).toBe("ASKING");
    const picked = step(asked.state, { type: "picked" }, cfg);
    expect(picked.effect).toBe("react");
    expect(picked.state.phase).toBe("COOLDOWN");
    expect(step(picked.state, { type: "picked" }, cfg).effect).toBeNull();
  });

  it("retry count resets for the next card", () => {
    let s = run([MOVING, STILL, STILL, STILL]).s;
    s = step(s, { type: "result", status: "rejected" }, cfg).state;
    s = run(times(10, EMPTY), s).s;
    expect(s).toEqual(initialState);
  });

  it("wantsSharpness only when the next still frame could trigger recognition", () => {
    const cand: MachineState = { ...initialState, phase: "CANDIDATE", stableFrames: 2 };
    expect(wantsSharpness(cand, 1, cfg)).toBe(true);
    expect(wantsSharpness({ ...cand, stableFrames: 0 }, 1, cfg)).toBe(false);
    expect(wantsSharpness(cand, 10, cfg)).toBe(false);
    expect(wantsSharpness(initialState, 1, cfg)).toBe(false);
  });
});

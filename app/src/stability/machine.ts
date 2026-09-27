// Recognition state machine — change-based (human decision 2026-09-26; PLAN.md §5.5 revised).
// Pure reducer; unit tested.
//
// "Something new is in the box" = the view differs from the LAST CHECKED view (`change`), not from
// a background snapshot: with a webcam facing the user, the "empty" box is their face and room, which
// moves and re-exposes, so a background snapshot went stale after every card.
//
// IDLE        ──change > CHANGE_T──▶ CANDIDATE
// CANDIDATE   ──still for STABLE_FRAMES + sharp, and still changed (or retrying)──▶ RECOGNIZING
// CANDIDATE   ──still, but back to the already-checked view──▶ IDLE
// RECOGNIZING ──accepted──▶ COOLDOWN (fire reaction)
// RECOGNIZING ──ask──▶ ASKING ──user picks──▶ COOLDOWN (fire reaction)
// RECOGNIZING ──rejected──▶ CANDIDATE (retry, max RETRIES) then COOLDOWN
// COOLDOWN    ──change > CHANGE_T (card removed or swapped)──▶ CANDIDATE
//
// The frame loop takes the "last checked" snapshot when it acts on a "recognize" effect, so the
// same card held still never re-triggers: one reaction per card hold.

export type Phase = "IDLE" | "CANDIDATE" | "RECOGNIZING" | "ASKING" | "COOLDOWN";

export interface MachineConfig {
  CHANGE_T: number;
  MOTION_T: number;
  STABLE_FRAMES: number;
  SHARP_T: number;
  RETRIES: number;
}

export interface MachineState {
  phase: Phase;
  stableFrames: number; // consecutive low-motion frames while CANDIDATE
  retries: number; // rejected recognitions of the current view
  outcome: "none" | "accepted" | "unsure"; // how the last recognition of this view ended (for the UI)
}

export interface FrameSignals {
  change: number; // mean abs diff vs the last checked view (0–255); 255 when nothing was checked yet
  motion: number; // mean abs diff vs the previous frame
  sharpness: number | null; // null when not computed (motion too high)
}

export type MachineEvent =
  | { type: "frame"; signals: FrameSignals }
  | { type: "result"; status: "accepted" | "rejected" | "ask" }
  | { type: "picked" } // user chose a printing in the ASKING chooser
  | { type: "reset" };

export type Effect = "recognize" | "react" | "ask" | null;

export const initialState: MachineState = { phase: "IDLE", stableFrames: 0, retries: 0, outcome: "none" };

/** Does this phase need the (costlier) sharpness signal this frame? */
export function wantsSharpness(state: MachineState, motion: number, cfg: MachineConfig): boolean {
  return state.phase === "CANDIDATE" && motion < cfg.MOTION_T && state.stableFrames + 1 >= cfg.STABLE_FRAMES;
}

export function step(
  s: MachineState,
  e: MachineEvent,
  cfg: MachineConfig,
): { state: MachineState; effect: Effect } {
  if (e.type === "reset") return { state: initialState, effect: null };

  if (e.type === "result") {
    if (s.phase !== "RECOGNIZING") return { state: s, effect: null }; // stale result
    if (e.status === "accepted") return { state: cooldown(s, "accepted"), effect: "react" };
    if (e.status === "ask") return { state: { ...s, phase: "ASKING" }, effect: "ask" };
    const retries = s.retries + 1;
    if (retries > cfg.RETRIES) return { state: { ...cooldown(s, "unsure"), retries }, effect: null };
    return { state: { ...s, phase: "CANDIDATE", stableFrames: 0, retries }, effect: null };
  }

  if (e.type === "picked") {
    if (s.phase !== "ASKING") return { state: s, effect: null };
    return { state: cooldown(s, "accepted"), effect: "react" };
  }

  const { change, motion, sharpness } = e.signals;
  const changed = change > cfg.CHANGE_T;

  switch (s.phase) {
    case "IDLE":
      return changed
        ? { state: { ...s, phase: "CANDIDATE", stableFrames: 0, retries: 0 }, effect: null }
        : { state: s, effect: null };

    case "CANDIDATE": {
      const stableFrames = motion < cfg.MOTION_T ? s.stableFrames + 1 : 0;
      if (stableFrames < cfg.STABLE_FRAMES) return { state: { ...s, stableFrames }, effect: null };
      const retrying = s.retries > 0;
      if (!changed && !retrying) return { state: { ...initialState, outcome: s.outcome }, effect: null };
      const sharp = sharpness !== null && sharpness > cfg.SHARP_T;
      if (!sharp) return { state: { ...s, stableFrames }, effect: null };
      return { state: { ...s, phase: "RECOGNIZING", stableFrames }, effect: "recognize" };
    }

    case "RECOGNIZING":
    case "ASKING":
      return { state: s, effect: null }; // one recognition in flight; wait for result / choice

    case "COOLDOWN":
      return changed
        ? { state: { ...s, phase: "CANDIDATE", stableFrames: 0, retries: 0, outcome: "none" }, effect: null }
        : { state: s, effect: null };
  }
}

function cooldown(s: MachineState, outcome: MachineState["outcome"]): MachineState {
  return { ...s, phase: "COOLDOWN", stableFrames: 0, outcome };
}

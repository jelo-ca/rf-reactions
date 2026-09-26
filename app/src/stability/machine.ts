// Recognition state machine (PLAN.md §5.5). Pure reducer; unit tested.
//
// IDLE ──presence > PRESENT_T──▶ CANDIDATE
// CANDIDATE ──motion < MOTION_T for STABLE_FRAMES AND sharpness > SHARP_T──▶ RECOGNIZING
// CANDIDATE ──presence < PRESENT_T for EMPTY_FRAMES──▶ IDLE
// RECOGNIZING ──accepted──▶ RESOLVED (fire reaction) ──▶ COOLDOWN
// RECOGNIZING ──ask──▶ ASKING ──user picks──▶ RESOLVED (fire reaction) ──▶ COOLDOWN
// RECOGNIZING ──rejected──▶ CANDIDATE (retry, max RETRIES, then COOLDOWN)
// COOLDOWN ──presence < PRESENT_T for EMPTY_FRAMES──▶ IDLE
//
// RESOLVED is transient: the step that resolves emits a "react" effect and lands in COOLDOWN,
// so a reaction can fire at most once per card hold.

export type Phase = "IDLE" | "CANDIDATE" | "RECOGNIZING" | "ASKING" | "COOLDOWN";

export interface MachineConfig {
  PRESENT_T: number;
  MOTION_T: number;
  STABLE_FRAMES: number;
  SHARP_T: number;
  EMPTY_FRAMES: number;
  RETRIES: number;
}

export interface MachineState {
  phase: Phase;
  stableFrames: number; // consecutive low-motion frames while CANDIDATE
  emptyFrames: number; // consecutive no-presence frames while CANDIDATE / COOLDOWN
  retries: number; // rejected recognitions in this hold
}

export interface FrameSignals {
  presence: number;
  motion: number;
  sharpness: number | null; // null when not computed (motion too high)
}

export type MachineEvent =
  | { type: "frame"; signals: FrameSignals }
  | { type: "result"; status: "accepted" | "rejected" | "ask" }
  | { type: "picked" } // user chose a printing in the ASKING chooser
  | { type: "reset" };

export type Effect = "recognize" | "react" | "ask" | null;

export const initialState: MachineState = { phase: "IDLE", stableFrames: 0, emptyFrames: 0, retries: 0 };

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
    if (e.status === "accepted") return { state: cooldown(s), effect: "react" };
    if (e.status === "ask") return { state: { ...s, phase: "ASKING" }, effect: "ask" };
    const retries = s.retries + 1;
    if (retries > cfg.RETRIES) return { state: { ...cooldown(s), retries }, effect: null };
    return { state: { ...s, phase: "CANDIDATE", stableFrames: 0, emptyFrames: 0, retries }, effect: null };
  }

  if (e.type === "picked") {
    if (s.phase !== "ASKING") return { state: s, effect: null };
    return { state: cooldown(s), effect: "react" };
  }

  const { presence, motion, sharpness } = e.signals;
  const present = presence > cfg.PRESENT_T;

  switch (s.phase) {
    case "IDLE":
      return present
        ? { state: { ...initialState, phase: "CANDIDATE" }, effect: null }
        : { state: s, effect: null };

    case "CANDIDATE": {
      if (!present) {
        const emptyFrames = s.emptyFrames + 1;
        if (emptyFrames >= cfg.EMPTY_FRAMES) return { state: initialState, effect: null };
        return { state: { ...s, emptyFrames, stableFrames: 0 }, effect: null };
      }
      const stableFrames = motion < cfg.MOTION_T ? s.stableFrames + 1 : 0;
      const sharp = sharpness !== null && sharpness > cfg.SHARP_T;
      if (stableFrames >= cfg.STABLE_FRAMES && sharp) {
        return { state: { ...s, phase: "RECOGNIZING", stableFrames, emptyFrames: 0 }, effect: "recognize" };
      }
      return { state: { ...s, stableFrames, emptyFrames: 0 }, effect: null };
    }

    case "RECOGNIZING":
    case "ASKING":
      return { state: s, effect: null }; // one recognition in flight; wait for result / choice

    case "COOLDOWN": {
      if (present) return { state: { ...s, emptyFrames: 0 }, effect: null };
      const emptyFrames = s.emptyFrames + 1;
      return emptyFrames >= cfg.EMPTY_FRAMES
        ? { state: initialState, effect: null }
        : { state: { ...s, emptyFrames }, effect: null };
    }
  }
}

function cooldown(s: MachineState): MachineState {
  return { ...s, phase: "COOLDOWN", stableFrames: 0, emptyFrames: 0 };
}

// Per-frame loop (PLAN.md §5.3): crop the guide box into tiny grayscale images on the main
// thread, compute signals, drive the state machine. Recognition is injected (stubbed in Phase 2).
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { guideBoxVideoRect } from "../camera/guideBox";
import { CFG } from "../config";
import { type FrameSignals, type MachineEvent, type MachineState, initialState, step, wantsSharpness } from "./machine";
import { laplacianVariance, meanAbsDiff, toGray } from "./signals";

export type RecognizeFn = () => Promise<"accepted" | "rejected" | "ask">;

export interface StabilityStats {
  state: MachineState;
  signals: FrameSignals;
  fps: number;
  hasBackground: boolean;
  lastStableToRecognizeMs: number | null; // first still frame of the run → RECOGNIZING
  lastStillToResultMs: number | null; // first still frame → recognition result (end to end)
  lastEffect: string | null;
  reactions: number;
}

const STATS_EVERY_N_FRAMES = 3; // throttle React re-renders

export function useStability(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  recognize: RecognizeFn,
  onReact: () => void,
) {
  const [stats, setStats] = useState<StabilityStats>({
    state: initialState,
    signals: { presence: 0, motion: 0, sharpness: null },
    fps: 0,
    hasBackground: false,
    lastStableToRecognizeMs: null,
    lastStillToResultMs: null,
    lastEffect: null,
    reactions: 0,
  });

  const r = useRef({
    machine: initialState,
    prev: null as Float32Array | null,
    background: null as Float32Array | null,
    frames: 0,
    stableStartAt: 0,
    lastStableToRecognizeMs: null as number | null,
    lastStillToResultMs: null as number | null,
    dispatch: null as ((e: MachineEvent) => void) | null,
    lastEffect: null as string | null,
    reactions: 0,
    fpsWindow: [] as number[],
    tiny: null as CanvasRenderingContext2D | null,
    sharp: null as CanvasRenderingContext2D | null,
    wantBackground: false,
    recognize,
    onReact,
  });
  useLayoutEffect(() => {
    r.current.recognize = recognize;
    r.current.onReact = onReact;
  }, [recognize, onReact]);

  const captureBackground = useCallback(() => {
    r.current.wantBackground = true;
  }, []);

  /** The user chose a printing in the ASKING chooser. */
  const pick = useCallback(() => {
    r.current.dispatch?.({ type: "picked" });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    const s = r.current;
    s.tiny ??= makeCtx(CFG.TINY_W, CFG.TINY_H);
    s.sharp ??= makeCtx(CFG.SHARP_W, CFG.SHARP_H);
    let stopped = false;
    let handle = 0;

    const dispatch = (e: MachineEvent) => {
      const before = s.machine;
      const { state, effect } = step(before, e, CFG);
      if (before.stableFrames === 0 && state.stableFrames === 1) s.stableStartAt = performance.now();
      s.machine = state;
      if (effect) s.lastEffect = effect;
      if (effect === "recognize") {
        s.lastStableToRecognizeMs = performance.now() - s.stableStartAt;
        const started = s.stableStartAt;
        const onResult = (status: "accepted" | "rejected" | "ask") => {
          s.lastStillToResultMs = performance.now() - started;
          dispatch({ type: "result", status });
        };
        s.recognize().then(onResult, (err: unknown) => {
          console.error("[vision] recognize failed:", err);
          onResult("rejected"); // never leave the machine stuck in RECOGNIZING
        });
      } else if (effect === "react") {
        s.reactions++;
        s.onReact();
      }
    };

    s.dispatch = dispatch;

    const onFrame = () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const box = guideBoxVideoRect(video.videoWidth, video.videoHeight, CFG.GUIDE_HEIGHT_FRAC, CFG.MODEL_W, CFG.MODEL_H);
        const gray = grab(s.tiny!, video, box, CFG.TINY_W, CFG.TINY_H);
        s.frames++;
        if (s.wantBackground || (!s.background && s.frames >= CFG.BACKGROUND_WARMUP_FRAMES)) {
          s.background = gray;
          s.wantBackground = false;
          dispatch({ type: "reset" });
        }
        const presence = s.background ? meanAbsDiff(gray, s.background) : 0;
        const motion = s.prev ? meanAbsDiff(gray, s.prev) : 255;
        s.prev = gray;
        const sharpness = wantsSharpness(s.machine, motion, CFG)
          ? laplacianVariance(grab(s.sharp!, video, box, CFG.SHARP_W, CFG.SHARP_H), CFG.SHARP_W, CFG.SHARP_H)
          : null;
        const signals = { presence, motion, sharpness };
        if (s.background) dispatch({ type: "frame", signals });

        const now = performance.now();
        s.fpsWindow.push(now);
        while (s.fpsWindow.length && now - s.fpsWindow[0] > 1000) s.fpsWindow.shift();
        if (s.frames % STATS_EVERY_N_FRAMES === 0) {
          setStats({
            state: s.machine,
            signals,
            fps: s.fpsWindow.length,
            hasBackground: !!s.background,
            lastStableToRecognizeMs: s.lastStableToRecognizeMs,
            lastStillToResultMs: s.lastStillToResultMs,
            lastEffect: s.lastEffect,
            reactions: s.reactions,
          });
        }
      }
      schedule();
    };

    const schedule = () => {
      handle =
        "requestVideoFrameCallback" in video
          ? video.requestVideoFrameCallback(onFrame)
          : requestAnimationFrame(onFrame);
    };
    schedule();

    return () => {
      stopped = true;
      if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [active, videoRef]);

  return { stats, captureBackground, pick };
}

function makeCtx(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

/** Draw the guide-box region of the *raw* (unmirrored) video frame into a small canvas → grayscale. */
function grab(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  box: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
): Float32Array {
  ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
}

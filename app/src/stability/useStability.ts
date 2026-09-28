// Per-frame loop (PLAN.md §5.3): crop the guide box into tiny grayscale images on the main
// thread, compute signals, drive the state machine. Recognition is injected.
// Change-based: `change` = difference from the view last sent to recognition (no background).
// Card detection (§5.7): when the detector sees a card, the signals are computed on the warped card
// wherever it is and recognition gets its corners; otherwise the guide box is watched (fallback).
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { guideBoxVideoRect } from "../camera/guideBox";
import { CFG } from "../config";
import { type FrameSignals, type MachineEvent, type MachineState, initialState, step, wantsSharpness } from "./machine";
import { type Quad, scaleQuad, warpGray } from "../vision/homography";
import type { DetectResult } from "../vision/worker";
import { chooseRegion, cornersMoving, type Detection, type Region, toVideoQuad } from "./region";
import { laplacianVariance, meanAbsDiff, toGray } from "./signals";

export type RecognizeFn = (quad: Quad | null) => Promise<"accepted" | "rejected" | "ask">;
export type DetectFn = () => Promise<DetectResult>;

export interface DetectionStats {
  enabled: boolean;
  source: Region["source"];
  present: number | null;
  quad: Quad | null; // video pixels, latest detection (even when below the threshold: null then)
  ms: number | null;
  moving: boolean;
  lostResets: number; // times a card was forgotten after DETECT_LOST_MS without one (debug: double reactions)
}

export interface StabilityStats {
  state: MachineState;
  signals: FrameSignals;
  fps: number;
  ready: boolean; // camera warm-up done (auto-exposure settled)
  lastStableToRecognizeMs: number | null; // first still frame of the run → RECOGNIZING
  lastStillToResultMs: number | null; // first still frame → recognition result (end to end)
  lastEffect: string | null;
  reactions: number;
  detection: DetectionStats;
}

const STATS_EVERY_N_FRAMES = 3; // throttle React re-renders

export function useStability(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  recognize: RecognizeFn,
  onReact: () => void,
  detect: DetectFn | null = null,
  guideFallback = false, // true only once the detector is known to be missing → watch the guide box
) {
  const [stats, setStats] = useState<StabilityStats>({
    state: initialState,
    signals: { change: 0, motion: 0, sharpness: null },
    fps: 0,
    ready: false,
    lastStableToRecognizeMs: null,
    lastStillToResultMs: null,
    lastEffect: null,
    reactions: 0,
    detection: { enabled: false, source: "none", present: null, quad: null, ms: null, moving: false, lostResets: 0 },
  });

  const r = useRef({
    machine: initialState,
    prev: null as Float32Array | null,
    checked: null as Float32Array | null, // the view last sent to recognition
    lastGray: null as Float32Array | null,
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
    wantRescan: false,
    recognize,
    onReact,
    detect,
    guideFallback,
    det: null as Detection | null,
    detInFlight: false,
    lastDetectAt: 0,
    detMoving: false,
    lastCardAt: 0,
    lostResets: 0,
    region: { source: "guide", quad: null } as Region,
    frame: null as CanvasRenderingContext2D | null, // downscaled full frame for warping the card
  });
  useLayoutEffect(() => {
    r.current.recognize = recognize;
    r.current.onReact = onReact;
    r.current.detect = detect;
    r.current.guideFallback = guideFallback;
    if (!detect) r.current.det = null;
  }, [recognize, onReact, detect, guideFallback]);

  /** Forget the last checked view so the current one is checked again (B). */
  const rescan = useCallback(() => {
    r.current.wantRescan = true;
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
        s.checked = s.lastGray; // this view is now "checked": holding it still won't re-trigger
        const started = s.stableStartAt;
        const onResult = (status: "accepted" | "rejected" | "ask") => {
          s.lastStillToResultMs = performance.now() - started;
          dispatch({ type: "result", status });
        };
        s.recognize(s.region.quad).then(onResult, (err: unknown) => {
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
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const now = performance.now();
        if (s.detect && !s.detInFlight && now - s.lastDetectAt >= CFG.DETECT_EVERY_MS) {
          s.detInFlight = true;
          s.lastDetectAt = now;
          s.detect()
            .then((res) => {
              const d: Detection = {
                present: res.present,
                quad: res.present >= CFG.DETECT_KEEP_T ? toVideoQuad(res.corners, vw, vh) : null,
                at: now,
                ms: res.ms,
              };
              s.detMoving = cornersMoving(s.det, d, CFG);
              s.det = d;
            })
            .catch((err: unknown) => console.warn("[detect] failed:", err))
            .finally(() => {
              s.detInFlight = false;
            });
        }
        // While the detector is still loading there is nothing to watch (no invisible guide box).
        const region = chooseRegion(s.det, now, CFG, !s.guideFallback, s.region.source === "detector");
        s.region = region;
        s.frames++;
        if (s.wantRescan) {
          s.checked = null;
          s.wantRescan = false;
          dispatch({ type: "reset" });
        }
        const ready = s.frames >= CFG.WARMUP_FRAMES;
        let signals: FrameSignals;
        if (region.source === "none") {
          // Detector on, no card anywhere: nothing to watch. Once the card has been gone a while,
          // forget it, so the next card (even a duplicate of the same printing) is checked again.
          // Never mid-recognition or while the "which one?" chooser is open.
          const busy = s.machine.phase === "RECOGNIZING" || s.machine.phase === "ASKING";
          if (s.checked && !busy && now - s.lastCardAt >= CFG.DETECT_LOST_MS) {
            s.checked = null;
            s.prev = null;
            s.lostResets++;
            dispatch({ type: "reset" });
          }
          signals = { change: 0, motion: 0, sharpness: null };
        } else {
          let gray: Float32Array;
          let sharpGray: () => Float32Array;
          if (region.source === "detector") {
            s.lastCardAt = now;
            const fw = CFG.DETECT_FRAME_W;
            const fh = Math.round((fw * vh) / vw);
            if (!s.frame || s.frame.canvas.height !== fh) s.frame = makeCtx(fw, fh);
            s.frame.drawImage(video, 0, 0, fw, fh);
            const full = toGray(s.frame.getImageData(0, 0, fw, fh).data, fw, fh);
            const q = scaleQuad(region.quad, fw / vw, fh / vh);
            gray = warpGray(full, fw, fh, q, CFG.TINY_W, CFG.TINY_H);
            sharpGray = () => warpGray(full, fw, fh, q, CFG.SHARP_W, CFG.SHARP_H);
          } else {
            const box = guideBoxVideoRect(vw, vh, CFG.GUIDE_HEIGHT_FRAC, CFG.MODEL_W, CFG.MODEL_H);
            gray = grab(s.tiny!, video, box, CFG.TINY_W, CFG.TINY_H);
            sharpGray = () => grab(s.sharp!, video, box, CFG.SHARP_W, CFG.SHARP_H);
          }
          const change = s.checked ? meanAbsDiff(gray, s.checked) : 255;
          let motion = s.prev ? meanAbsDiff(gray, s.prev) : 255;
          // The warped card looks the same while it slides across the frame; corner movement catches that.
          if (region.source === "detector" && s.detMoving) motion = Math.max(motion, CFG.MOTION_T * 2);
          s.prev = gray;
          s.lastGray = gray;
          const sharpness = wantsSharpness(s.machine, motion, CFG)
            ? laplacianVariance(sharpGray(), CFG.SHARP_W, CFG.SHARP_H)
            : null;
          signals = { change, motion, sharpness };
          if (ready) dispatch({ type: "frame", signals });
        }

        s.fpsWindow.push(now);
        while (s.fpsWindow.length && now - s.fpsWindow[0] > 1000) s.fpsWindow.shift();
        if (s.frames % STATS_EVERY_N_FRAMES === 0) {
          setStats({
            state: s.machine,
            signals,
            fps: s.fpsWindow.length,
            ready,
            lastStableToRecognizeMs: s.lastStableToRecognizeMs,
            lastStillToResultMs: s.lastStillToResultMs,
            lastEffect: s.lastEffect,
            reactions: s.reactions,
            detection: {
              enabled: !!s.detect,
              source: region.source,
              present: s.det?.present ?? null,
              quad: s.det?.quad ?? null,
              ms: s.det?.ms ?? null,
              moving: s.detMoving,
              lostResets: s.lostResets,
            },
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

  return { stats, rescan, pick };
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

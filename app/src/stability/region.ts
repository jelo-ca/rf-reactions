// Which part of the frame the stability loop watches (PLAN.md §5.7): the detected card when the
// detector is confident and recent, else the guide box (fallback). Pure; unit tested.
import type { Quad } from "../vision/homography";
import { quadJitter } from "../vision/homography";

export interface Detection {
  present: number; // probability 0–1
  quad: Quad | null; // video pixels, TL, TR, BR, BL
  at: number; // performance.now() when the frame was grabbed
  ms: number; // detector time (worker, incl. preprocessing)
}

export type Region = { source: "detector"; quad: Quad } | { source: "guide"; quad: null };

export interface RegionConfig {
  DETECT_PRESENT_T: number;
  DETECT_STALE_MS: number;
  DETECT_JITTER_T: number;
}

export function chooseRegion(det: Detection | null, now: number, cfg: RegionConfig): Region {
  if (det && det.quad && det.present >= cfg.DETECT_PRESENT_T && now - det.at <= cfg.DETECT_STALE_MS) {
    return { source: "detector", quad: det.quad };
  }
  return { source: "guide", quad: null };
}

/** True when the card's corners moved enough between two detections to count as "not still". */
export function cornersMoving(prev: Detection | null, next: Detection, cfg: RegionConfig): boolean {
  if (!prev?.quad || !next.quad) return false;
  return quadJitter(prev.quad, next.quad) > cfg.DETECT_JITTER_T;
}

/** Detector output (0–1 corners in the stretched input) → video pixels. */
export function toVideoQuad(corners: readonly [number, number][], videoW: number, videoH: number): Quad {
  return corners.map(([x, y]) => [x * videoW, y * videoH]) as Quad;
}

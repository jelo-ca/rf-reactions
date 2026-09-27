// Runtime thresholds — the single place for tunable numbers (PLAN.md §5.6, §6.4).
// Initial values; calibrated in Phase 3.
export const CFG = {
  // Stability (§5.4–5.5)
  CHANGE_T: 12, // mean abs diff vs the last checked view (0–255): above = something new in the box
  MOTION_T: 4, // mean abs diff between consecutive frames
  STABLE_FRAMES: 3,
  SHARP_T: 60, // Laplacian variance
  RETRIES: 2,

  // Recognition (§6.4) — names mirror pipeline/config.py
  // PROVISIONAL (2026-09-26): eval.py sweep on 18 in-sample photos / 3 cards, step-1000 fine-tuned
  // embedder, clean references only: 7/18 accepted, 0 wrong. Mirrors pipeline/config.py. Recalibrate
  // on a fresh eval set.
  ACCEPT_T: 0.42, // cosine score
  MARGIN_T: 0.03, // best minus runner-up (different card names)
  EMBED_WEIGHT: 0.5,
  LAYOUT_WEIGHT: 0.5,
  LAYOUT_MARGIN_T: 0.03,

  // Geometry (§5.2–5.3)
  MODEL_W: 224,
  MODEL_H: 320,
  GUIDE_HEIGHT_FRAC: 0.55, // guide box height as a fraction of the video height
  TINY_W: 48, // per-frame analysis image (grayscale)
  TINY_H: 68,
  SHARP_W: 112, // sharpness crop, only when motion is low
  SHARP_H: 160,

  // Camera (§5.1)
  CAMERA_IDEAL_W: 1920,
  CAMERA_IDEAL_H: 1080,
  WARMUP_FRAMES: 60, // ignore the first ~2s of video while auto-exposure settles

} as const;

export type Config = typeof CFG;

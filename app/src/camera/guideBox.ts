// Guide box geometry (PLAN.md §5.2). Pure; unit tested.
// The box is defined in *video pixel* coordinates; the overlay position is derived from it,
// accounting for the <video> element's object-fit scaling and offsets.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ObjectFit = "cover" | "contain";

/** Centered portrait box with aspect modelW:modelH, heightFrac of the video height (clamped to fit). */
export function guideBoxVideoRect(
  videoW: number,
  videoH: number,
  heightFrac: number,
  modelW: number,
  modelH: number,
): Rect {
  let h = Math.round(videoH * heightFrac);
  let w = Math.round((h * modelW) / modelH);
  if (w > videoW) {
    w = videoW;
    h = Math.round((w * modelH) / modelW);
  }
  return { x: Math.round((videoW - w) / 2), y: Math.round((videoH - h) / 2), w, h };
}

/** Scale + offset that maps video pixels to element (CSS) pixels under object-fit. */
export function videoToElementTransform(
  videoW: number,
  videoH: number,
  elW: number,
  elH: number,
  fit: ObjectFit,
): { scale: number; offsetX: number; offsetY: number } {
  const sx = elW / videoW;
  const sy = elH / videoH;
  const scale = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  return { scale, offsetX: (elW - videoW * scale) / 2, offsetY: (elH - videoH * scale) / 2 };
}

export function videoRectToElement(
  r: Rect,
  videoW: number,
  videoH: number,
  elW: number,
  elH: number,
  fit: ObjectFit,
): Rect {
  const { scale, offsetX, offsetY } = videoToElementTransform(videoW, videoH, elW, elH, fit);
  return { x: offsetX + r.x * scale, y: offsetY + r.y * scale, w: r.w * scale, h: r.h * scale };
}

/** Video → stage transform for overlays drawn over the <video> (inset by the ring-light padding). */
export interface StageTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  left: number; // video element offset inside the stage
  top: number;
  elW: number; // video element width (for mirroring)
}

/** A video-pixel point → stage pixels, honouring object-fit and the CSS mirror (scaleX(-1)). */
export function videoPointToStage(p: readonly [number, number], xf: StageTransform, mirrored: boolean): [number, number] {
  let x = xf.offsetX + p[0] * xf.scale;
  const y = xf.offsetY + p[1] * xf.scale;
  if (mirrored) x = xf.elW - x;
  return [x + xf.left, y + xf.top];
}

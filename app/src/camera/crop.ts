// The exact 224×320 crop the recognizer sees (PLAN.md §6.2). Capture mode saves the same crop.
import { CFG } from "../config";
import { type Quad, warpRgba } from "../vision/homography";
import { guideBoxVideoRect } from "./guideBox";

/** Guide-box region of the raw (unmirrored) video frame, stretched to MODEL_W×MODEL_H. */
export function cropForModel(video: HTMLVideoElement): Promise<ImageBitmap> {
  const box = guideBoxVideoRect(video.videoWidth, video.videoHeight, CFG.GUIDE_HEIGHT_FRAC, CFG.MODEL_W, CFG.MODEL_H);
  return createImageBitmap(video, box.x, box.y, box.w, box.h, {
    resizeWidth: CFG.MODEL_W,
    resizeHeight: CFG.MODEL_H,
    resizeQuality: "high",
  });
}

/**
 * The detected card (corners in raw video pixels) warped upright to MODEL_W×MODEL_H from the
 * full-resolution frame: the same warp the worker does before recognition (PLAN.md §5.7).
 */
export function cropDetected(video: HTMLVideoElement, quad: Quad): Promise<ImageBitmap> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const ctx = new OffscreenCanvas(w, h).getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(video, 0, 0);
  const out = new Uint8ClampedArray(new ArrayBuffer(CFG.MODEL_W * CFG.MODEL_H * 4));
  warpRgba(ctx.getImageData(0, 0, w, h).data, w, h, quad, CFG.MODEL_W, CFG.MODEL_H, out);
  return createImageBitmap(new ImageData(out, CFG.MODEL_W, CFG.MODEL_H));
}

export async function bitmapToPngBlob(bmp: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bmp, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/** `<printing_id>__<timestamp>.png` — pipeline/sort_eval.py files these into data/eval/<printing_id>/. */
export function captureFileName(printingId: string, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${printingId}__${ts}.png`;
}

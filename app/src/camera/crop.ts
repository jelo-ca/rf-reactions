// The exact 224×320 crop the recognizer sees (PLAN.md §6.2). Capture mode saves the same crop.
import { CFG } from "../config";
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

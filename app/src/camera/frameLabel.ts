// Full-frame capture + corner labels for training/validating the card detector (PLAN.md §5.7).
// Files: `frame__<printing_id|none>__<timestamp>.png` + `.json`; pipeline/sort_detect.py files them.

export type Point = [number, number];

export interface FrameLabel {
  /** Card corners in raw (unmirrored) frame pixels, TL, TR, BR, BL in the card's own orientation; null = no card. */
  corners: Point[] | null;
  width: number;
  height: number;
  printingId: string | null; // the printing held, when one was picked in capture mode (for recognition checks)
  capturedAt: string;
}

export function frameFileStem(printingId: string | null, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `frame__${printingId ?? "none"}__${ts}`;
}

/**
 * A click on the displayed (object-fit: contain) frame → raw frame pixels, clamped to the frame.
 * `box` is the element's client rect; the image is letterboxed inside it.
 */
export function clickToFrame(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
): Point {
  const scale = Math.min(box.width / frameW, box.height / frameH);
  const offX = box.left + (box.width - frameW * scale) / 2;
  const offY = box.top + (box.height - frameH * scale) / 2;
  const x = Math.min(frameW, Math.max(0, (clientX - offX) / scale));
  const y = Math.min(frameH, Math.max(0, (clientY - offY) / scale));
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

/** Raw frame pixels → position inside the displayed element (for drawing the clicked dots). */
export function frameToDisplay(p: Point, box: { width: number; height: number }, frameW: number, frameH: number): Point {
  const scale = Math.min(box.width / frameW, box.height / frameH);
  return [(box.width - frameW * scale) / 2 + p[0] * scale, (box.height - frameH * scale) / 2 + p[1] * scale];
}

/** Twice the signed area (shoelace). Positive = clockwise on screen (y down) = TL→TR→BR→BL order. */
export function signedArea2(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/** Why a set of 4 clicked corners is unusable, or null if fine. */
export function cornerProblem(pts: readonly Point[], minArea = 400): string | null {
  if (pts.length !== 4) return "need 4 corners";
  const a = signedArea2(pts);
  if (a <= 0) return "corners must go clockwise: top-left, top-right, bottom-right, bottom-left";
  if (a / 2 < minArea) return "card too small";
  // convex: every turn has the same sign
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 4];
    const [cx, cy] = pts[(i + 2) % 4];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return "corners don't form a convex card shape";
  }
  return null;
}

export function makeLabel(corners: Point[] | null, width: number, height: number, printingId: string | null, now = new Date()): FrameLabel {
  return { corners, width, height, printingId, capturedAt: now.toISOString() };
}

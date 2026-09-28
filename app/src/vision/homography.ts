// Perspective math for the card detector (PLAN.md §5.7): 4 corners → homography → warp the card
// to an upright rectangle (the 224×320 recognizer crop, or the tiny stability images).
// Conventions match OpenCV (pipeline/tests/gen_homography_fixtures.py): integer pixel coordinates,
// bilinear sampling, black outside the source.

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL
export type Mat3 = number[]; // row-major 3×3, h[8] = 1

/** Homography mapping src[i] → dst[i] (same as cv2.getPerspectiveTransform). */
export function solveHomography(src: readonly Pt[], dst: readonly Pt[]): Mat3 {
  // 8 equations, 8 unknowns (h0..h7), h8 = 1.
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the augmented 8×9 matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error("degenerate quad (3 corners in a line?)");
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      if (f !== 0) for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  const h = a.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function project(h: Mat3, x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Output pixel (x, y) of an outW×outH upright rect → source pixel, for warping `quad`. */
export function rectToQuad(quad: Quad, outW: number, outH: number): Mat3 {
  return solveHomography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
}

/** Warp the quad in an RGBA image to an upright outW×outH RGBA image (bilinear, black outside). */
export function warpRgba(
  src: Uint8ClampedArray, srcW: number, srcH: number, quad: Quad, outW: number, outH: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(outW * outH * 4),
): Uint8ClampedArray {
  const h = rectToQuad(quad, outW, outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = project(h, x, y);
      const o = (y * outW + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const p00 = px(src, srcW, srcH, x0, y0, c);
        const p10 = px(src, srcW, srcH, x0 + 1, y0, c);
        const p01 = px(src, srcW, srcH, x0, y0 + 1, c);
        const p11 = px(src, srcW, srcH, x0 + 1, y0 + 1, c);
        out[o + c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

function px(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: number): number {
  return x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + c];
}

/** Warp the quad in a grayscale float image to an upright outW×outH one (bilinear, edge-clamped). */
export function warpGray(src: Float32Array, srcW: number, srcH: number, quad: Quad, outW: number, outH: number): Float32Array {
  const h = rectToQuad(quad, outW, outH);
  const out = new Float32Array(outW * outH);
  const at = (x: number, y: number) =>
    src[Math.min(srcH - 1, Math.max(0, y)) * srcW + Math.min(srcW - 1, Math.max(0, x))];
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // sample at pixel centres so a coarse output averages the right area
      const [sx, sy] = project(h, x + 0.5, y + 0.5);
      const fx0 = sx - 0.5;
      const fy0 = sy - 0.5;
      const x0 = Math.floor(fx0);
      const y0 = Math.floor(fy0);
      const fx = fx0 - x0;
      const fy = fy0 - y0;
      out[y * outW + x] =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}

/** Scale a quad (e.g. detector 0–1 output → frame pixels). */
export const scaleQuad = (q: readonly Pt[], sx: number, sy: number): Quad =>
  q.map(([x, y]) => [x * sx, y * sy] as Pt) as Quad;

/** Mean corner movement between two quads, as a fraction of the (average) card height. */
export function quadJitter(a: Quad, b: Quad): number {
  const d = a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4;
  return d / Math.max(1e-6, quadHeight(a));
}

/** Average length of the card's left and right edges. */
export function quadHeight(q: Quad): number {
  return (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
}

/** Axis-aligned bounds of a quad (for the debug overlay label). */
export function quadBounds(q: Quad): { x: number; y: number; w: number; h: number } {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

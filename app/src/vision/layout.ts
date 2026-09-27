// Layout signature + score (PLAN.md §4.7a). MUST match pipeline/layout.py exactly:
//   gray = 0.299 R + 0.587 G + 0.114 B in [0,1] → 4×4 box average to 56×80 → Sobel magnitude
//   (borders replicated) → divide by max(mean, LAYOUT_MIN_MEAN). All math in float64, stored float32.
// Score: mean per-tile cosine over a 4×5 grid; tiles with no edges (norm < LAYOUT_TILE_EPS)
// count 1 if empty in both maps, 0 if empty in one.

export const LAYOUT = {
  IN_W: 224,
  IN_H: 320,
  W: 56,
  H: 80,
  GRID_COLS: 4,
  GRID_ROWS: 5,
  MIN_MEAN: 1e-3,
  TILE_EPS: 1e-3,
} as const;

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/** rgba: 224×320 RGBA bytes (ImageData.data) → Float32Array(80*56), row-major. */
export function layoutSignature(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const { IN_W, IN_H, W, H } = LAYOUT;
  if (rgba.length !== IN_W * IN_H * 4) throw new Error(`expected ${IN_W}x${IN_H} RGBA, got ${rgba.length} bytes`);
  const f = IN_W / W; // 4

  // 1–2. grayscale + exact box average
  const small = new Float64Array(W * H);
  for (let y = 0; y < IN_H; y++) {
    const sy = Math.floor(y / f);
    for (let x = 0; x < IN_W; x++) {
      const p = (y * IN_W + x) * 4;
      const g = 0.299 * (rgba[p] / 255) + 0.587 * (rgba[p + 1] / 255) + 0.114 * (rgba[p + 2] / 255);
      small[sy * W + Math.floor(x / f)] += g;
    }
  }
  for (let i = 0; i < small.length; i++) small[i] /= f * f;

  // 3. Sobel magnitude, edge-replicated borders
  const mag = new Float64Array(W * H);
  let sum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let gx = 0;
      let gy = 0;
      for (let dy = 0; dy < 3; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy - 1));
        for (let dx = 0; dx < 3; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx - 1));
          const v = small[yy * W + xx];
          gx += SOBEL_X[dy * 3 + dx] * v;
          gy += SOBEL_Y[dy * 3 + dx] * v;
        }
      }
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[y * W + x] = m;
      sum += m;
    }
  }

  // 4. normalize by the mean (floored)
  const denom = Math.max(sum / mag.length, LAYOUT.MIN_MEAN);
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = mag[i] / denom;
  return out;
}

/** Mean per-tile cosine; `b` may be a view into a larger array (e.g. a layout.bin row). */
export function layoutScore(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const { W, H, GRID_COLS, GRID_ROWS, TILE_EPS } = LAYOUT;
  const tw = W / GRID_COLS;
  const th = H / GRID_ROWS;
  let total = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let y = r * th; y < (r + 1) * th; y++) {
        for (let x = c * tw; x < (c + 1) * tw; x++) {
          const i = y * W + x;
          dot += a[i] * b[i];
          na += a[i] * a[i];
          nb += b[i] * b[i];
        }
      }
      const la = Math.sqrt(na);
      const lb = Math.sqrt(nb);
      const emptyA = la < TILE_EPS;
      const emptyB = lb < TILE_EPS;
      total += emptyA || emptyB ? (emptyA && emptyB ? 1 : 0) : dot / (la * lb);
    }
  }
  return total / (GRID_ROWS * GRID_COLS);
}

// Frame signals (PLAN.md §5.4). Pure functions on small grayscale images; unit tested.

/** RGBA bytes → grayscale 0–255 (same weights as the layout signature). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return out;
}

/** Mean absolute difference between two same-size grayscale images (0–255 scale). */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`size mismatch: ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return a.length ? sum / a.length : 0;
}

/** Variance of the 3×3 Laplacian (4-neighbour) over interior pixels — higher = sharper. */
export function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

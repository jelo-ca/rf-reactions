import { describe, expect, it } from "vitest";
import { laplacianVariance, meanAbsDiff, toGray } from "./signals";

const flat = (w: number, h: number, v: number) => new Float32Array(w * h).fill(v);

describe("toGray", () => {
  it("uses 0.299/0.587/0.114 weights and ignores alpha", () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 7, 0, 255, 0, 7, 0, 0, 255, 7]), 3, 1);
    expect(g[0]).toBeCloseTo(76.245);
    expect(g[1]).toBeCloseTo(149.685);
    expect(g[2]).toBeCloseTo(29.07);
  });
});

describe("meanAbsDiff", () => {
  it("is zero for identical frames and the mean |a-b| otherwise", () => {
    expect(meanAbsDiff(flat(4, 4, 10), flat(4, 4, 10))).toBe(0);
    expect(meanAbsDiff(flat(4, 4, 10), flat(4, 4, 30))).toBe(20);
  });

  it("rejects mismatched sizes", () => {
    expect(() => meanAbsDiff(flat(2, 2, 0), flat(3, 3, 0))).toThrow(/size mismatch/);
  });
});

describe("laplacianVariance", () => {
  it("is zero for a flat image", () => {
    expect(laplacianVariance(flat(16, 16, 128), 16, 16)).toBe(0);
  });

  it("is higher for a sharp checkerboard than a blurred one", () => {
    const w = 16;
    const sharp = new Float32Array(w * w);
    const soft = new Float32Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const v = (x + y) % 2 ? 255 : 0;
        sharp[y * w + x] = v;
        soft[y * w + x] = 128 + (v - 128) * 0.1;
      }
    expect(laplacianVariance(sharp, w, w)).toBeGreaterThan(laplacianVariance(soft, w, w) * 10);
  });

  it("returns 0 for images too small for a 3x3 kernel", () => {
    expect(laplacianVariance(flat(2, 2, 5), 2, 2)).toBe(0);
  });
});

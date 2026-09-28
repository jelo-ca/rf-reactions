import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/homography_parity.json";
import {
  project, type Quad, quadBounds, quadHeight, quadJitter, rectToQuad, scaleQuad, solveHomography, warpGray, warpRgba,
} from "./homography";

/** Same formula as pipeline/tests/gen_homography_fixtures.py `synth`, as RGBA. */
function synth(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = (x * 4) % 256;
      out[o + 1] = (y * 5) % 256;
      out[o + 2] = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 200 + 20;
      out[o + 3] = 255;
    }
  }
  return out;
}

describe("homography vs OpenCV fixtures", () => {
  const { srcW, srcH, outW, outH, cases } = fixture;
  const img = synth(srcW, srcH);

  it.each(cases.map((c, i) => [i, c] as const))("case %i: same matrix as cv2.getPerspectiveTransform", (_, c) => {
    const h = rectToQuad(c.quad as Quad, outW, outH);
    h.forEach((v, i) => expect(v).toBeCloseTo(c.H[i], 6));
  });

  it.each(cases.map((c, i) => [i, c] as const))("case %i: warp matches cv2.warpPerspective", (_, c) => {
    const got = warpRgba(img, srcW, srcH, c.quad as Quad, outW, outH);
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let p = 0; p < outW * outH; p++) {
      for (let ch = 0; ch < 3; ch++) {
        const d = Math.abs(got[p * 4 + ch] - c.warped[p * 3 + ch]);
        sum += d;
        max = Math.max(max, d);
        n++;
      }
    }
    // OpenCV interpolates in fixed point (1/32 px); allow rounding-level differences only.
    expect(sum / n).toBeLessThan(1.5);
    expect(max).toBeLessThanOrEqual(8);
  });
});

describe("homography basics", () => {
  const quad: Quad = [[10, 20], [110, 30], [100, 170], [5, 160]];
  it("maps the corners exactly", () => {
    const h = solveHomography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
    const back = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => project(h, x, y));
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(quad[i][0], 9);
      expect(p[1]).toBeCloseTo(quad[i][1], 9);
    });
  });
  it("rejects a degenerate quad", () => {
    expect(() => solveHomography([[0, 0], [1, 0], [2, 0], [3, 0]], quad)).toThrow(/degenerate/);
  });
  it("warpGray samples a uniform region exactly", () => {
    const src = new Float32Array(50 * 40).fill(7);
    const out = warpGray(src, 50, 40, [[5, 5], [30, 6], [29, 35], [4, 34]], 6, 8);
    expect(Math.max(...out)).toBeCloseTo(7, 5);
    expect(Math.min(...out)).toBeCloseTo(7, 5);
  });
  it("quad helpers", () => {
    const q: Quad = [[0, 0], [7, 0], [7, 10], [0, 10]];
    expect(quadHeight(q)).toBe(10);
    expect(quadJitter(q, q)).toBe(0);
    expect(quadJitter(q, q.map(([x, y]) => [x + 1, y]) as Quad)).toBeCloseTo(0.1);
    expect(scaleQuad([[0.5, 0.5], [1, 0], [1, 1], [0, 1]], 200, 100)[0]).toEqual([100, 50]);
    expect(quadBounds([[2, 3], [9, 1], [8, 12], [1, 11]])).toEqual({ x: 1, y: 1, w: 8, h: 11 });
  });
});

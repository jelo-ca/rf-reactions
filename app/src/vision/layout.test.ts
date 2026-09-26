// Cross-language parity: expectations come from pipeline/layout.py via pipeline/tests/gen_ts_fixtures.py.
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/layout_parity.json";
import { LAYOUT, layoutScore, layoutSignature } from "./layout";

/** Same formulas as gen_ts_fixtures.py `synth`. */
function synth(kind: number): Uint8ClampedArray {
  const { IN_W, IN_H } = LAYOUT;
  const out = new Uint8ClampedArray(IN_W * IN_H * 4);
  for (let y = 0; y < IN_H; y++) {
    for (let x = 0; x < IN_W; x++) {
      let r: number, g: number, b: number;
      if (kind === 0) {
        r = (x * x + 3 * y) % 256;
        g = (5 * x + y * y) % 256;
        b = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 200;
      } else if (kind === 1 || kind === 2) {
        const x0 = kind === 1 ? 16 : 60;
        r = g = b = y >= 200 && y < 260 && x >= x0 && x < x0 + 104 ? 230 : 40;
      } else {
        r = g = b = 128;
      }
      const p = (y * IN_W + x) * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
  return out;
}

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : na === nb ? 1 : 0;
};

describe("layout signature parity with pipeline/layout.py", () => {
  const sigs = [0, 1, 2, 3].map((k) => layoutSignature(synth(k)));

  it("matches Python signatures element-wise", () => {
    sigs.forEach((s, k) => {
      const expected = fixture.signatures[k];
      expect(s.length).toBe(expected.length);
      let maxErr = 0;
      for (let i = 0; i < s.length; i++) maxErr = Math.max(maxErr, Math.abs(s[i] - expected[i]));
      expect(maxErr).toBeLessThan(1e-4);
      expect(cosine(s, expected)).toBeGreaterThan(0.999999);
    });
  });

  it("matches Python layout scores, including the empty-tile rule", () => {
    for (const [key, expected] of Object.entries(fixture.scores)) {
      const [i, j] = key.split("-").map(Number);
      expect(layoutScore(sigs[i], sigs[j])).toBeCloseTo(expected as number, 5);
    }
  });

  it("separates left-aligned from centered text", () => {
    expect(layoutScore(sigs[1], sigs[1])).toBeCloseTo(1);
    expect(layoutScore(sigs[1], sigs[2])).toBeLessThan(0.95);
  });

  it("rejects wrong input size", () => {
    expect(() => layoutSignature(new Uint8ClampedArray(10))).toThrow(/expected 224x320/);
  });
});

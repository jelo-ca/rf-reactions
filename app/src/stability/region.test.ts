import { describe, expect, it } from "vitest";
import type { Quad } from "../vision/homography";
import { chooseRegion, cornersMoving, type Detection, toVideoQuad } from "./region";

const cfg = { DETECT_PRESENT_T: 0.5, DETECT_STALE_MS: 400, DETECT_JITTER_T: 0.03 };
const quad: Quad = [[100, 100], [200, 100], [200, 240], [100, 240]]; // 140 px tall
const det = (extra: Partial<Detection> = {}): Detection => ({ present: 0.9, quad, at: 1000, ms: 12, ...extra });

describe("chooseRegion", () => {
  it("uses a confident, fresh detection", () => {
    expect(chooseRegion(det(), 1200, cfg)).toEqual({ source: "detector", quad });
  });
  it("falls back to the guide box when unsure, stale, absent or missing", () => {
    expect(chooseRegion(det({ present: 0.3 }), 1200, cfg).source).toBe("guide");
    expect(chooseRegion(det(), 1401, cfg).source).toBe("guide");
    expect(chooseRegion(det({ quad: null }), 1200, cfg).source).toBe("guide");
    expect(chooseRegion(null, 1200, cfg).source).toBe("guide");
  });
});

describe("cornersMoving", () => {
  const shifted = (dx: number) => det({ quad: quad.map(([x, y]) => [x + dx, y]) as Quad });
  it("ignores small jitter and flags real movement", () => {
    expect(cornersMoving(det(), shifted(2), cfg)).toBe(false); // 2/140 = 1.4%
    expect(cornersMoving(det(), shifted(10), cfg)).toBe(true); // 7%
  });
  it("is false without two quads", () => {
    expect(cornersMoving(null, det(), cfg)).toBe(false);
    expect(cornersMoving(det({ quad: null }), det(), cfg)).toBe(false);
  });
});

describe("toVideoQuad", () => {
  it("scales 0–1 corners to video pixels", () => {
    expect(toVideoQuad([[0.5, 0.5], [1, 0], [1, 1], [0, 1]], 1920, 1080)[0]).toEqual([960, 540]);
  });
});

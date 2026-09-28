import { describe, expect, it } from "vitest";
import type { Quad } from "../vision/homography";
import { chooseRegion, cornersMoving, type Detection, toVideoQuad } from "./region";

const cfg = { DETECT_PRESENT_T: 0.5, DETECT_KEEP_T: 0.3, DETECT_STALE_MS: 400, DETECT_JITTER_T: 0.03 };
const quad: Quad = [[100, 100], [200, 100], [200, 240], [100, 240]]; // 140 px tall
const det = (extra: Partial<Detection> = {}): Detection => ({ present: 0.9, quad, at: 1000, ms: 12, ...extra });

describe("chooseRegion", () => {
  it("uses a confident, fresh detection", () => {
    expect(chooseRegion(det(), 1200, cfg, true)).toEqual({ source: "detector", quad });
  });
  it("watches nothing when the detector is on but unsure, stale or empty", () => {
    expect(chooseRegion(det({ present: 0.3 }), 1200, cfg, true).source).toBe("none");
    expect(chooseRegion(det(), 1401, cfg, true).source).toBe("none");
    expect(chooseRegion(det({ quad: null }), 1200, cfg, true).source).toBe("none");
    expect(chooseRegion(null, 1200, cfg, true).source).toBe("none");
  });
  it("keeps a tracked card through brief confidence dips (hysteresis)", () => {
    expect(chooseRegion(det({ present: 0.4 }), 1200, cfg, true, false).source).toBe("none"); // not yet tracking
    expect(chooseRegion(det({ present: 0.4 }), 1200, cfg, true, true).source).toBe("detector"); // already tracking
    expect(chooseRegion(det({ present: 0.2 }), 1200, cfg, true, true).source).toBe("none");
  });
  it("uses the guide box only when the detector is unavailable", () => {
    expect(chooseRegion(det(), 1200, cfg, false)).toEqual({ source: "guide", quad: null });
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

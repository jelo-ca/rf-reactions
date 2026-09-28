import { describe, expect, it } from "vitest";
import { clickToFrame, cornerProblem, frameFileStem, frameToDisplay, makeLabel, type Point, signedArea2 } from "./frameLabel";

const box = { left: 100, top: 50, width: 800, height: 600 }; // 1920×1080 frame letterboxed: scale 800/1920

describe("frameFileStem", () => {
  it("encodes printing (or none) and a UTC timestamp", () => {
    const d = new Date("2026-09-27T10:11:12.345Z");
    expect(frameFileStem("OGN-151", d)).toBe("frame__OGN-151__20260927T101112Z");
    expect(frameFileStem(null, d)).toBe("frame__none__20260927T101112Z");
  });
});

describe("clickToFrame / frameToDisplay", () => {
  const s = 800 / 1920; // 0.41667; image is 450 tall, centred with 75px bars
  it("maps letterboxed clicks to raw frame pixels", () => {
    expect(clickToFrame(100, 50 + 75, box, 1920, 1080)).toEqual([0, 0]);
    expect(clickToFrame(900, 50 + 75 + 450, box, 1920, 1080)).toEqual([1920, 1080]);
    expect(clickToFrame(500, 350, box, 1920, 1080)).toEqual([960, 540]);
  });
  it("clamps clicks on the bars to the frame", () => {
    expect(clickToFrame(500, 55, box, 1920, 1080)).toEqual([960, 0]);
  });
  it("round-trips", () => {
    const p: Point = [640, 300];
    const [dx, dy] = frameToDisplay(p, box, 1920, 1080);
    expect(clickToFrame(box.left + dx, box.top + dy, box, 1920, 1080)).toEqual(p);
    expect(dx).toBeCloseTo(640 * s);
  });
});

describe("cornerProblem", () => {
  const card: Point[] = [[100, 100], [200, 110], [190, 260], [95, 250]];
  it("accepts a clockwise convex quad", () => {
    expect(signedArea2(card)).toBeGreaterThan(0);
    expect(cornerProblem(card)).toBeNull();
  });
  it("rejects anticlockwise, too few, tiny and self-crossing quads", () => {
    expect(cornerProblem([...card].reverse())).toMatch(/clockwise/);
    expect(cornerProblem(card.slice(0, 3))).toMatch(/4 corners/);
    expect(cornerProblem([[0, 0], [5, 0], [5, 5], [0, 5]])).toMatch(/too small/);
    expect(cornerProblem([[100, 100], [200, 100], [110, 250], [200, 250]])).not.toBeNull();
  });
});

describe("makeLabel", () => {
  it("builds the sidecar JSON", () => {
    const d = new Date("2026-09-27T10:11:12.345Z");
    expect(makeLabel(null, 1280, 720, null, d)).toEqual({
      corners: null, width: 1280, height: 720, printingId: null, capturedAt: "2026-09-27T10:11:12.345Z",
    });
  });
});

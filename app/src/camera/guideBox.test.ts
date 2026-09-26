import { describe, expect, it } from "vitest";
import { guideBoxVideoRect, videoRectToElement, videoToElementTransform } from "./guideBox";

describe("guideBoxVideoRect", () => {
  it("is centered, 55% tall, 224:320 aspect in video pixels", () => {
    const r = guideBoxVideoRect(1920, 1080, 0.55, 224, 320);
    expect(r.h).toBe(594);
    expect(r.w).toBe(Math.round((594 * 224) / 320));
    expect(r.x).toBe(Math.round((1920 - r.w) / 2));
    expect(r.y).toBe(Math.round((1080 - 594) / 2));
  });

  it("clamps to the video width for narrow (portrait) video", () => {
    const r = guideBoxVideoRect(300, 2000, 0.55, 224, 320);
    expect(r.w).toBe(300);
    expect(r.h).toBe(Math.round((300 * 320) / 224));
    expect(r.x).toBe(0);
  });
});

describe("videoRectToElement", () => {
  const box = { x: 400, y: 200, w: 224, h: 320 };

  it("identity when element matches video size", () => {
    expect(videoRectToElement(box, 1280, 720, 1280, 720, "cover")).toEqual(box);
  });

  it("contain: letterboxes (scale by the smaller axis, offset on the other)", () => {
    // 1280x720 video in a 640x640 element → scale 0.5, 180px bars top/bottom
    const t = videoToElementTransform(1280, 720, 640, 640, "contain");
    expect(t).toEqual({ scale: 0.5, offsetX: 0, offsetY: 140 });
    expect(videoRectToElement(box, 1280, 720, 640, 640, "contain")).toEqual({ x: 200, y: 240, w: 112, h: 160 });
  });

  it("cover: crops (scale by the larger axis, negative offset)", () => {
    // 1280x720 video in a 640x640 element → scale 640/720, sides cropped
    const t = videoToElementTransform(1280, 720, 640, 640, "cover");
    expect(t.scale).toBeCloseTo(640 / 720);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo((640 - 1280 * (640 / 720)) / 2);
    const r = videoRectToElement(box, 1280, 720, 640, 640, "cover");
    expect(r.x).toBeCloseTo(t.offsetX + 400 * t.scale);
    expect(r.w).toBeCloseTo(224 * t.scale);
  });

  it("a centered video box stays centered in the element under either fit", () => {
    const g = guideBoxVideoRect(1920, 1080, 0.55, 224, 320);
    for (const fit of ["cover", "contain"] as const) {
      const r = videoRectToElement(g, 1920, 1080, 800, 600, fit);
      expect(r.x + r.w / 2).toBeCloseTo(400, 0);
      expect(r.y + r.h / 2).toBeCloseTo(300, 0);
    }
  });
});

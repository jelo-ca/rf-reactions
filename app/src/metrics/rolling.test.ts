import { describe, expect, it } from "vitest";
import { Timings, percentile, summarize } from "./rolling";

describe("percentile", () => {
  it("nearest-rank on unsorted input", () => {
    const v = [50, 10, 40, 20, 30];
    expect(percentile(v, 50)).toBe(30);
    expect(percentile(v, 95)).toBe(50);
    expect(percentile(v, 0)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });

  it("p95 of 1..100 is 95", () => {
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });
});

describe("Timings", () => {
  it("summarizes named series and caps history", () => {
    const t = new Timings(3);
    [5, 1, 2, 3].forEach((ms) => t.add("search", ms));
    expect(t.summary().search).toEqual(summarize([1, 2, 3]));
    expect(t.summary().search.n).toBe(3);
  });
});

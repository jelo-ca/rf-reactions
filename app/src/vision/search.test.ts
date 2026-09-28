import { describe, expect, it } from "vitest";
import { bestPerPrinting, buildIndex, search, topK } from "./search";

const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

// 3 printings, 2 rows each (clean + augmented), dim 3
const IDS = ["A", "A", "B", "B", "C", "C"];
const DATA = new Float32Array([
  ...unit([1, 0, 0]), ...unit([0.9, 0.1, 0]),
  ...unit([0, 1, 0]), ...unit([0.1, 0.9, 0.1]),
  ...unit([0, 0, 1]), ...unit([0.5, 0, 0.5]),
]);

describe("search", () => {
  it("returns best row per printing, sorted", () => {
    const q = new Float32Array(unit([0.95, 0.05, 0]));
    const r = search(DATA, IDS, 3, q, 3);
    expect(r.map((m) => m.printingId)).toEqual(["A", "C", "B"]);
    expect(r[0].score).toBeGreaterThan(0.99);
  });

  it("takes the max over a printing's rows (augmented row can win)", () => {
    const q = new Float32Array(unit([0.6, 0, 0.4]));
    const idx = buildIndex(DATA, IDS, 3);
    const best = bestPerPrinting(idx, q);
    expect(best[2]).toBeCloseTo(unit([0.5, 0, 0.5]).reduce((s, v, i) => s + v * unit([0.6, 0, 0.4])[i], 0), 5);
  });

  it("topK honours an allow predicate and k", () => {
    const idx = buildIndex(DATA, IDS, 3);
    const best = bestPerPrinting(idx, new Float32Array(unit([1, 0, 0])));
    expect(topK(idx, best, 1).map((m) => m.printingId)).toEqual(["A"]);
    expect(topK(idx, best, 5, (id) => id !== "A").map((m) => m.printingId)).toEqual(["C", "B"]);
  });

  it("rejects mismatched sizes", () => {
    expect(() => buildIndex(new Float32Array(5), IDS, 3)).toThrow(/embeddings/);
  });

  it("is fast enough at demo scale (11.6k rows x 1280)", () => {
    const rows = 11583, dim = 1280;
    const data = new Float32Array(rows * dim).map(() => Math.random() - 0.5);
    const ids = Array.from({ length: rows }, (_, i) => `P${Math.floor(i / 9)}`);
    const idx = buildIndex(data, ids, dim);
    const q = new Float32Array(dim).fill(1 / Math.sqrt(dim));
    bestPerPrinting(idx, q); // warm up JIT
    // Best of 5: other test files run in parallel, and the mean mostly measured their CPU load.
    let ms = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      bestPerPrinting(idx, q);
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`search 11583x1280: ${ms.toFixed(1)} ms/query (node)`);
    expect(ms).toBeLessThan(100); // generous in CI; the real budget (p95 <= 20ms) is measured in the browser
  });
});

describe("bestFromScores (search baked into the model)", () => {
  it("matches bestPerPrinting on the same data", async () => {
    const { bestFromScores, rowIndex } = await import("./search");
    const q = new Float32Array(unit([0.3, 0.6, 0.1]));
    const idx = buildIndex(DATA, IDS, 3);
    const rowScores = Array.from({ length: IDS.length }, (_, r) =>
      DATA.slice(r * 3, r * 3 + 3).reduce((s, v, d) => s + v * q[d], 0));
    const { rowPrinting, printingIds } = rowIndex(IDS);
    expect(printingIds).toEqual(idx.printingIds);
    const a = bestFromScores(rowScores, rowPrinting, printingIds.length);
    const b = bestPerPrinting(idx, q);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));
    expect(() => bestFromScores([1], rowPrinting, 3)).toThrow(/scores/);
  });
});

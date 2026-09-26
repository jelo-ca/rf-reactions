// Exact brute-force search (PLAN.md §6.3). Pure; unit tested.
// Rows and query are unit length, so the dot product is cosine similarity.
import type { Match } from "../types";

/** Index built once at load: row → printing index, and the printing ids. */
export interface SearchIndex {
  data: Float32Array; // [rows * dim], row-major, unit rows
  dim: number;
  rowPrinting: Int32Array; // row → index into printingIds
  printingIds: string[]; // distinct ids in first-seen order
}

export function buildIndex(data: Float32Array, ids: readonly string[], dim: number): SearchIndex {
  if (data.length !== ids.length * dim) throw new Error(`embeddings ${data.length} != ${ids.length} x ${dim}`);
  const printingIds: string[] = [];
  const pos = new Map<string, number>();
  const rowPrinting = new Int32Array(ids.length);
  ids.forEach((id, r) => {
    let p = pos.get(id);
    if (p === undefined) {
      p = printingIds.length;
      pos.set(id, p);
      printingIds.push(id);
    }
    rowPrinting[r] = p;
  });
  return { data, dim, rowPrinting, printingIds };
}

/** Best (max) cosine per printing. Plain indexed loops so the JIT can optimize. */
export function bestPerPrinting(index: SearchIndex, query: Float32Array): Float32Array {
  const { data, dim, rowPrinting, printingIds } = index;
  const best = new Float32Array(printingIds.length).fill(-Infinity);
  const rows = rowPrinting.length;
  const dim4 = dim - (dim % 4);
  for (let r = 0, base = 0; r < rows; r++, base += dim) {
    // 4 independent accumulators: breaks the add dependency chain (~2x faster in V8).
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    let d = 0;
    for (; d < dim4; d += 4) {
      s0 += data[base + d] * query[d];
      s1 += data[base + d + 1] * query[d + 1];
      s2 += data[base + d + 2] * query[d + 2];
      s3 += data[base + d + 3] * query[d + 3];
    }
    for (; d < dim; d++) s0 += data[base + d] * query[d];
    const score = s0 + s1 + s2 + s3;
    const p = rowPrinting[r];
    if (score > best[p]) best[p] = score;
  }
  return best;
}

/** Top-k printings by score, optionally restricted by a predicate (e.g. pack mode). */
export function topK(
  index: SearchIndex,
  best: Float32Array,
  k: number,
  allow: (printingId: string) => boolean = () => true,
): Match[] {
  const out: Match[] = [];
  for (let p = 0; p < best.length; p++) {
    const id = index.printingIds[p];
    if (allow(id)) out.push({ printingId: id, score: best[p] });
  }
  out.sort((a, b) => b.score - a.score || (a.printingId < b.printingId ? -1 : 1));
  return out.slice(0, k);
}

/** PLAN.md §6.3 reference signature: top-k distinct printings. */
export function search(data: Float32Array, ids: readonly string[], dim: number, query: Float32Array, k = 5): Match[] {
  const index = buildIndex(data, ids, dim);
  return topK(index, bestPerPrinting(index, query), k);
}

/** Row → printing mapping only (for scores computed inside the model). */
export function rowIndex(ids: readonly string[]): { rowPrinting: Int32Array; printingIds: string[] } {
  const printingIds: string[] = [];
  const pos = new Map<string, number>();
  const rowPrinting = new Int32Array(ids.length);
  ids.forEach((id, r) => {
    let p = pos.get(id);
    if (p === undefined) {
      p = printingIds.length;
      pos.set(id, p);
      printingIds.push(id);
    }
    rowPrinting[r] = p;
  });
  return { rowPrinting, printingIds };
}

/** Best score per printing from per-row scores (the recognizer model's `scores` output). */
export function bestFromScores(scores: ArrayLike<number>, rowPrinting: Int32Array, nPrintings: number): Float32Array {
  if (scores.length !== rowPrinting.length) throw new Error(`scores ${scores.length} != rows ${rowPrinting.length}`);
  const best = new Float32Array(nPrintings).fill(-Infinity);
  for (let r = 0; r < rowPrinting.length; r++) {
    const p = rowPrinting[r];
    if (scores[r] > best[p]) best[p] = scores[r];
  }
  return best;
}

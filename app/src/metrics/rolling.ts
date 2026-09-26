// Rolling percentiles over a session (PLAN.md §10.1). Pure; unit tested.

/** Nearest-rank percentile of `values` (p in 0..100). Returns null for no data. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
}

export function summarize(values: readonly number[]): Summary {
  return { n: values.length, p50: percentile(values, 50), p95: percentile(values, 95) };
}

/** Named series of timings; keeps at most `cap` recent samples per series. */
export class Timings {
  private series = new Map<string, number[]>();
  private readonly cap: number;
  constructor(cap = 500) {
    this.cap = cap;
  }

  add(name: string, ms: number): void {
    const s = this.series.get(name) ?? [];
    s.push(ms);
    if (s.length > this.cap) s.shift();
    this.series.set(name, s);
  }

  summary(): Record<string, Summary> {
    return Object.fromEntries([...this.series].map(([k, v]) => [k, summarize(v)]));
  }
}

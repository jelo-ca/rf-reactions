// Shared data contracts (PLAN.md §3.3, §6.4b). Keep in sync with pipeline/ingest.py.

export type Variant = "normal" | "foil" | "alt_art" | "promo";
export type Pool = "booster" | "nexus_night";
export type PackMode = "booster" | "nexus_night";

export interface Card {
  printingId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  variant: Variant;
  imageHash: string; // same hash = same picture (e.g. normal vs foil)
  imageUrl: string; // /data/images/<file>, for the price card UI
  pool: Pool;
}

export interface Price {
  printingId: string;
  priceUsd: number;
  source: string;
  asOf: string;
}

export interface EmbeddingMeta {
  modelFile: string; // embedder only
  recognizerFile?: string; // embedder + baked search (scores output), used by the worker
  inputWidth: 224;
  inputHeight: 320;
  dim: number;
  rows: number;
  rowsPerPrinting: number;
  dtype: "float32";
  layout: { width: 56; height: 80; gridCols: 4; gridRows: 5; printings: number };
  builtAt: string;
}

export interface Match {
  printingId: string;
  score: number;
}

export interface LayoutScore {
  printingId: string;
  layoutScore: number;
}

export type RecognitionReason =
  | "ok"
  | "low_score"
  | "low_margin"
  | "same_image_cheapest"
  | "layout_resolved"
  | "layout_ambiguous";

export interface RecognitionResult {
  status: "accepted" | "rejected" | "ask";
  best?: Match;
  top: Match[];
  askOptions?: string[];
  layout?: LayoutScore[];
  reason?: RecognitionReason;
  packMode: PackMode;
  timings: { prepMs: number; inferMs: number; searchMs: number; layoutMs: number };
}

/// <reference lib="webworker" />
// Vision worker (PLAN.md §6.1–6.4): crop → tensor → ONNX embed → search → layout → decide.
// Exposed to the main thread with Comlink. Everything is loaded once and kept in memory.
import * as Comlink from "comlink";
import * as ort from "onnxruntime-web/webgpu";
import { CFG } from "../config";
import type { Card, EmbeddingMeta, PackMode, Price, RecognitionResult } from "../types";
import { decide, indexCards } from "./decide";
import { LAYOUT, layoutScore, layoutSignature } from "./layout";
import { type SearchIndex, bestPerPrinting, buildIndex } from "./search";

export type Backend = "webgpu" | "wasm";

export interface InitInfo {
  backend: Backend;
  loadMs: number;
  warmupMs: number;
  rows: number;
  dim: number;
  printings: number;
  layoutPrintings: number;
  threads: number;
  crossOriginIsolated: boolean;
}

interface State {
  session: ort.InferenceSession;
  index: SearchIndex;
  layoutData: Float32Array;
  layoutRow: Map<string, number>;
  cards: ReturnType<typeof indexCards>;
  prices: Map<string, number>;
}

let state: State | null = null;
// init() must run once: React StrictMode (dev) calls effects twice, and concurrent
// InferenceSession.create calls crash ORT's wasm ("memory access out of bounds").
let initOnce: Promise<InitInfo> | null = null;
const canvas = new OffscreenCanvas(CFG.MODEL_W, CFG.MODEL_H);
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}
const json = <T,>(url: string) => fetchOk(url).then((r) => r.json() as Promise<T>);
const f32 = (url: string) => fetchOk(url).then((r) => r.arrayBuffer()).then((b) => new Float32Array(b));

async function createSession(modelUrl: string): Promise<{ session: ort.InferenceSession; backend: Backend }> {
  const opts = { graphOptimizationLevel: "all" } as const;
  if ("gpu" in navigator) {
    try {
      return { session: await ort.InferenceSession.create(modelUrl, { ...opts, executionProviders: ["webgpu"] }), backend: "webgpu" };
    } catch (e) {
      console.warn("[vision] WebGPU unavailable, falling back to wasm:", e);
    }
  }
  return { session: await ort.InferenceSession.create(modelUrl, { ...opts, executionProviders: ["wasm"] }), backend: "wasm" };
}

/** RGBA ImageData → planar RGB float32 [1,3,H,W] in [0,1] (normalization is inside the model). */
function toTensor(rgba: Uint8ClampedArray): ort.Tensor {
  const n = CFG.MODEL_W * CFG.MODEL_H;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = rgba[p] / 255;
    out[n + i] = rgba[p + 1] / 255;
    out[2 * n + i] = rgba[p + 2] / 255;
  }
  return new ort.Tensor("float32", out, [1, 3, CFG.MODEL_H, CFG.MODEL_W]);
}

function pixels(img: ImageBitmap): Uint8ClampedArray {
  ctx.clearRect(0, 0, CFG.MODEL_W, CFG.MODEL_H);
  ctx.drawImage(img, 0, 0, CFG.MODEL_W, CFG.MODEL_H);
  img.close();
  return ctx.getImageData(0, 0, CFG.MODEL_W, CFG.MODEL_H).data;
}

// ORT web sessions don't support concurrent run() calls (overlapping runs can hang on WebGPU),
// so inferences are queued one at a time.
let runQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = runQueue.then(fn, fn);
  runQueue = next.catch(() => undefined);
  return next;
}

async function embed(rgba: Uint8ClampedArray): Promise<Float32Array> {
  const out = await serialized(() => state!.session.run({ input: toTensor(rgba) }));
  // Copy: the output may be a view into ORT's (Shared)ArrayBuffer wasm memory, which is reused
  // between runs and can't be transferred to the main thread.
  return new Float32Array(out.embedding.data as Float32Array);
}

async function doInit(): Promise<InitInfo> {
    const t0 = performance.now();
    const [meta, emb, ids, layoutData, layoutIds, cards, prices] = await Promise.all([
      json<EmbeddingMeta>("/data/meta.json"),
      f32("/data/embeddings.bin"),
      json<string[]>("/data/embedding_ids.json"),
      f32("/data/layout.bin"),
      json<string[]>("/data/layout_ids.json"),
      json<Card[]>("/data/cards.json"),
      json<Price[]>("/data/prices.json"),
    ]);
    const { session, backend } = await createSession(meta.modelFile);
    state = {
      session,
      index: buildIndex(emb, ids, meta.dim),
      layoutData,
      layoutRow: new Map(layoutIds.map((id, i) => [id, i])),
      cards: indexCards(cards),
      prices: new Map(prices.map((p) => [p.printingId, p.priceUsd])),
    };
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    await embed(new Uint8ClampedArray(CFG.MODEL_W * CFG.MODEL_H * 4)); // warm-up on zeros
    return {
      backend,
      loadMs,
      warmupMs: performance.now() - t1,
      rows: ids.length,
      dim: meta.dim,
      printings: state.index.printingIds.length,
      layoutPrintings: layoutIds.length,
      threads: ort.env.wasm.numThreads ?? 1,
      crossOriginIsolated: self.crossOriginIsolated,
    };
}

const api = {
  init(): Promise<InitInfo> {
    initOnce ??= doInit().catch((e: unknown) => {
      initOnce = null; // allow a retry after a failure
      throw e;
    });
    return initOnce;
  },

  async recognize(img: ImageBitmap, packMode: PackMode): Promise<RecognitionResult> {
    if (!state) throw new Error("vision worker not initialized");
    const s = state;
    const t0 = performance.now();
    const rgba = pixels(img);
    const t1 = performance.now();
    const query = await embed(rgba);
    const t2 = performance.now();
    const best = bestPerPrinting(s.index, query);
    const scores = new Map(s.index.printingIds.map((id, p) => [id, best[p]]));
    const t3 = performance.now();

    let sig: Float32Array | null = null;
    let layoutMs = 0;
    const layoutScoreFor = (id: string): number | null => {
      const row = s.layoutRow.get(id);
      if (row === undefined) return null;
      const t = performance.now();
      sig ??= layoutSignature(rgba);
      const n = LAYOUT.W * LAYOUT.H;
      const v = layoutScore(sig, s.layoutData.subarray(row * n, (row + 1) * n));
      layoutMs += performance.now() - t;
      return v;
    };

    const d = decide(
      { scores, cards: s.cards.cards, byName: s.cards.byName, prices: s.prices, packMode, layoutScoreFor },
      CFG,
    );
    return { ...d, timings: { prepMs: t1 - t0, inferMs: t2 - t1, searchMs: t3 - t2, layoutMs } };
  },

  /** For the parity page and eval tools: embedding + layout signature of an image. */
  async signatures(img: ImageBitmap): Promise<{ embedding: Float32Array; layout: Float32Array }> {
    if (!state) throw new Error("vision worker not initialized");
    const rgba = pixels(img);
    const embedding = await embed(rgba);
    return Comlink.transfer({ embedding, layout: layoutSignature(rgba) }, [embedding.buffer]);
  },
};

export type VisionApi = typeof api;
Comlink.expose(api);

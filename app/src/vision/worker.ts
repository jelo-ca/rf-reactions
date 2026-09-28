/// <reference lib="webworker" />
// Vision worker (PLAN.md §6.1–6.4): crop → tensor → ONNX embed → search → layout → decide.
// Exposed to the main thread with Comlink. Everything is loaded once and kept in memory.
import * as Comlink from "comlink";
import * as ort from "onnxruntime-web/webgpu";
import { CFG } from "../config";
import type { Card, EmbeddingMeta, PackMode, Price, RecognitionResult } from "../types";
import { decide, indexCards } from "./decide";
import { type Quad, warpRgba } from "./homography";
import { LAYOUT, layoutScore, layoutSignature } from "./layout";
import { bestFromScores, rowIndex } from "./search";

export type Backend = "webgpu" | "wasm";

export interface DetectorInfo {
  available: boolean; // false when public/models/detector.onnx is missing → guide box only
  backend?: Backend;
  loadMs?: number;
  warmupMs?: number;
  error?: string;
}

export interface DetectResult {
  present: number; // probability 0–1
  corners: [number, number][]; // 0–1 in the (stretched) frame, TL, TR, BR, BL
  ms: number; // preprocessing + inference in the worker
}

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
  index: ReturnType<typeof rowIndex>;
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
const detCanvas = new OffscreenCanvas(CFG.DETECT_W, CFG.DETECT_H);
const detCtx = detCanvas.getContext("2d", { willReadFrequently: true })!;
const frameCanvas = new OffscreenCanvas(1, 1); // full-resolution frame for warping the detected card
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true })!;
let detector: { session: ort.InferenceSession } | null = null;
let detectorOnce: Promise<DetectorInfo> | null = null;

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
function toTensor(rgba: Uint8ClampedArray, w: number = CFG.MODEL_W, h: number = CFG.MODEL_H): ort.Tensor {
  const n = w * h;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = rgba[p] / 255;
    out[n + i] = rgba[p + 1] / 255;
    out[2 * n + i] = rgba[p + 2] / 255;
  }
  return new ort.Tensor("float32", out, [1, 3, h, w]);
}

/** Full frame + detected card corners (frame pixels) → the upright 224×320 crop the recognizer takes. */
function warpedPixels(frame: ImageBitmap, quad: Quad): Uint8ClampedArray {
  if (frameCanvas.width !== frame.width || frameCanvas.height !== frame.height) {
    frameCanvas.width = frame.width;
    frameCanvas.height = frame.height;
  }
  frameCtx.drawImage(frame, 0, 0);
  frame.close();
  const src = frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height).data;
  return warpRgba(src, frameCanvas.width, frameCanvas.height, quad, CFG.MODEL_W, CFG.MODEL_H);
}

async function loadDetector(): Promise<DetectorInfo> {
  const t0 = performance.now();
  const res = await fetch("/models/detector.onnx");
  // Vite's dev server answers unknown paths with index.html, so check the type too.
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("html")) {
    return { available: false, error: "no /models/detector.onnx - run pipeline/export_detector.py" };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const opts = { graphOptimizationLevel: "all" } as const;
  let backend: Backend = "wasm";
  let session: ort.InferenceSession | null = null;
  if ("gpu" in navigator) {
    try {
      session = await ort.InferenceSession.create(bytes, { ...opts, executionProviders: ["webgpu"] });
      backend = "webgpu";
    } catch (e) {
      console.warn("[detect] WebGPU unavailable, falling back to wasm:", e);
    }
  }
  session ??= await ort.InferenceSession.create(bytes, { ...opts, executionProviders: ["wasm"] });
  detector = { session };
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  await serialized(() => session.run({ frame: toTensor(new Uint8ClampedArray(CFG.DETECT_W * CFG.DETECT_H * 4), CFG.DETECT_W, CFG.DETECT_H) }));
  return { available: true, backend, loadMs, warmupMs: performance.now() - t1 };
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

/** Embedding + per-row cosine scores. The search (embedding @ E^T) is baked into recognizer.onnx
 *  so it runs in ONNX Runtime (WebGPU): the JS loop took ~70-80 ms/query in the browser. */
async function run(rgba: Uint8ClampedArray): Promise<{ embedding: Float32Array; scores: Float32Array }> {
  const out = await serialized(() => state!.session.run({ input: toTensor(rgba) }));
  // Copy: outputs may be views into ORT's (Shared)ArrayBuffer wasm memory, which is reused
  // between runs and can't be transferred to the main thread.
  return {
    embedding: new Float32Array(out.embedding.data as Float32Array),
    scores: new Float32Array(out.scores.data as Float32Array),
  };
}

async function doInit(): Promise<InitInfo> {
    const t0 = performance.now();
    const [meta, ids, layoutData, layoutIds, cards, prices] = await Promise.all([
      json<EmbeddingMeta>("/data/meta.json"),
      json<string[]>("/data/embedding_ids.json"),
      f32("/data/layout.bin"),
      json<string[]>("/data/layout_ids.json"),
      json<Card[]>("/data/cards.json"),
      json<Price[]>("/data/prices.json"),
    ]);
    if (!meta.recognizerFile) throw new Error("meta.json has no recognizerFile - run pipeline/export_search.py");
    const { session, backend } = await createSession(meta.recognizerFile);
    state = {
      session,
      index: rowIndex(ids),
      layoutData,
      layoutRow: new Map(layoutIds.map((id, i) => [id, i])),
      cards: indexCards(cards),
      prices: new Map(prices.map((p) => [p.printingId, p.priceUsd])),
    };
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    await run(new Uint8ClampedArray(CFG.MODEL_W * CFG.MODEL_H * 4)); // warm-up on zeros
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

  /** Load the card detector once (after init: the recognizer comes first). Never throws. */
  initDetector(): Promise<DetectorInfo> {
    detectorOnce ??= loadDetector().catch((e: unknown) => {
      console.warn("[detect] detector failed to load, using the guide box only:", e);
      return { available: false, error: String(e) };
    });
    return detectorOnce;
  },

  /** Card present? + its corners, on a frame already scaled to DETECT_W×DETECT_H (any size works). */
  async detect(frame: ImageBitmap): Promise<DetectResult> {
    if (!detector) throw new Error("detector not loaded");
    const t0 = performance.now();
    detCtx.drawImage(frame, 0, 0, CFG.DETECT_W, CFG.DETECT_H);
    frame.close();
    const rgba = detCtx.getImageData(0, 0, CFG.DETECT_W, CFG.DETECT_H).data;
    const d = detector;
    const out = await serialized(() => d.session.run({ frame: toTensor(rgba, CFG.DETECT_W, CFG.DETECT_H) }));
    const logit = (out.present.data as Float32Array)[0];
    const c = out.corners.data as Float32Array;
    const corners: [number, number][] = [0, 1, 2, 3].map((k) => [c[k * 2], c[k * 2 + 1]]);
    return { present: 1 / (1 + Math.exp(-logit)), corners, ms: performance.now() - t0 };
  },

  /** `img` = the 224×320 guide-box crop, or (with `quad`) the full frame + the detected card corners. */
  async recognize(img: ImageBitmap, packMode: PackMode, quad?: Quad): Promise<RecognitionResult> {
    if (!state) throw new Error("vision worker not initialized");
    const s = state;
    const t0 = performance.now();
    const rgba = quad ? warpedPixels(img, quad) : pixels(img);
    const t1 = performance.now();
    const { scores: rowScores } = await run(rgba);
    const t2 = performance.now();
    const best = bestFromScores(rowScores, s.index.rowPrinting, s.index.printingIds.length);
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
    const { embedding } = await run(rgba);
    return Comlink.transfer({ embedding, layout: layoutSignature(rgba) }, [embedding.buffer]);
  },
};

export type VisionApi = typeof api;
Comlink.expose(api);

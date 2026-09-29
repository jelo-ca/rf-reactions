// Main-thread side of recognition: init the worker, crop, recognize, keep timings and the
// "which one?" state. The state machine calls `recognize` once per stable card hold.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cropForModel } from "../camera/crop";
import { Timings, type Summary } from "../metrics/rolling";
import { SessionLog } from "../metrics/session";
import type { RecognizeFn } from "../stability/useStability";
import type { PackMode, RecognitionResult } from "../types";
import { transfer, vision } from "./client";
import type { Quad } from "./homography";
import type { InitInfo } from "./worker";

export interface RecognizerState {
  info: InitInfo | null;
  initError: string | null;
  last: (RecognitionResult & { cropMs: number; totalMs: number; source: "detector" | "guide" }) | null;
  /** Printing currently shown (accepted, or chosen in the chooser). */
  shownId: string | null;
  askOptions: string[] | null;
  summary: Record<string, Summary>;
  asks: number;
  readyAtMs: number | null; // performance.now() when the model finished loading (cold start)
  pulls: number; // records in the session log (re-renders the debug panel)
}

export function useRecognizer(videoRef: RefObject<HTMLVideoElement | null>, packMode: PackMode) {
  const [st, setSt] = useState<RecognizerState>({
    info: null, initError: null, last: null, shownId: null, askOptions: null, summary: {}, asks: 0, readyAtMs: null, pulls: 0,
  });
  const timings = useRef(new Timings());
  const [session] = useState(() => new SessionLog()); // mutable log, one per page load
  const lastStillAt = useRef(0);
  // Same as shownId, but set synchronously: the state machine fires the reaction right after
  // recognize()/choose() return, before React has committed the new state.
  const shownRef = useRef<string | null>(null);
  const packModeRef = useRef(packMode);
  useLayoutEffect(() => {
    packModeRef.current = packMode;
  }, [packMode]);

  useEffect(() => {
    vision()
      .init()
      .then((info) => setSt((s) => ({ ...s, info, readyAtMs: performance.now() })))
      .catch((e: unknown) => setSt((s) => ({ ...s, initError: String(e) })));
  }, []);

  const ready = st.info !== null;

  /** `quad` = detected card corners (video pixels) → warp in the worker; null → guide-box crop. */
  const recognize: RecognizeFn = useCallback(async (quad: Quad | null, stillAt: number) => {
    const video = videoRef.current;
    if (!ready || !video) return "rejected";
    const t0 = performance.now();
    lastStillAt.current = stillAt;
    const bmp = quad ? await createImageBitmap(video) : await cropForModel(video);
    const cropMs = performance.now() - t0;
    const r = await vision().recognize(transfer(bmp), packModeRef.current, quad ?? undefined);
    const totalMs = performance.now() - t0;

    const t = timings.current;
    t.add("crop+recognize", totalMs);
    t.add("infer", r.timings.inferMs);
    t.add("search", r.timings.searchMs);
    if (r.timings.layoutMs > 0) t.add("layout", r.timings.layoutMs);

    const guess = r.best ?? r.top[0];
    session.add({
      at: new Date().toISOString(), status: r.status, reason: r.reason ?? null,
      printingId: guess?.printingId ?? null, score: guess?.score ?? null, source: quad ? "detector" : "guide",
      packMode: packModeRef.current, stillToRecognizeMs: t0 - stillAt, stillToResultMs: performance.now() - stillAt,
      cropMs, ...r.timings, totalMs, stillToReactionMs: null, tier: null, viaChooser: false,
    });

    if (r.status === "accepted") shownRef.current = r.best!.printingId;
    setSt((s) => ({
      ...s,
      last: { ...r, cropMs, totalMs, source: quad ? "detector" : "guide" },
      summary: t.summary(),
      shownId: r.status === "accepted" ? r.best!.printingId : s.shownId,
      askOptions: r.status === "ask" ? r.askOptions ?? null : null,
      asks: s.asks + (r.status === "ask" ? 1 : 0),
      pulls: session.pulls.length,
    }));
    if (r.status !== "rejected") console.log("[vision]", r.status, r.reason, r.best?.printingId, r.timings);
    return r.status;
  }, [ready, videoRef, session]);

  /** User picked a printing in the chooser. Logged so frequent asks can be investigated. */
  const choose = useCallback((printingId: string) => {
    console.log("[vision] ask resolved by user:", printingId);
    shownRef.current = printingId;
    setSt((s) => ({ ...s, shownId: printingId, askOptions: null }));
  }, []);

  /** The reaction for this card starts now (called by the app right before it fires). */
  const logReaction = useCallback((printingId: string, tier: number) => {
    const viaChooser = session.pulls.at(-1)?.status === "ask";
    session.reacted(printingId, tier, performance.now() - lastStillAt.current, viaChooser);
  }, [session]);

  return { ...st, ready, recognize, choose, shownRef, logReaction, session };
}

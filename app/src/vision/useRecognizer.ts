// Main-thread side of recognition: init the worker, crop, recognize, keep timings and the
// "which one?" state. The state machine calls `recognize` once per stable card hold.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cropForModel } from "../camera/crop";
import { Timings, type Summary } from "../metrics/rolling";
import type { RecognizeFn } from "../stability/useStability";
import type { PackMode, RecognitionResult } from "../types";
import { transfer, vision } from "./client";
import type { InitInfo } from "./worker";

export interface RecognizerState {
  info: InitInfo | null;
  initError: string | null;
  last: (RecognitionResult & { cropMs: number; totalMs: number }) | null;
  /** Printing currently shown (accepted, or chosen in the chooser). */
  shownId: string | null;
  askOptions: string[] | null;
  summary: Record<string, Summary>;
  asks: number;
}

export function useRecognizer(videoRef: RefObject<HTMLVideoElement | null>, packMode: PackMode) {
  const [st, setSt] = useState<RecognizerState>({
    info: null, initError: null, last: null, shownId: null, askOptions: null, summary: {}, asks: 0,
  });
  const timings = useRef(new Timings());
  const packModeRef = useRef(packMode);
  useLayoutEffect(() => {
    packModeRef.current = packMode;
  }, [packMode]);

  useEffect(() => {
    vision()
      .init()
      .then((info) => setSt((s) => ({ ...s, info })))
      .catch((e: unknown) => setSt((s) => ({ ...s, initError: String(e) })));
  }, []);

  const ready = st.info !== null;

  const recognize: RecognizeFn = useCallback(async () => {
    const video = videoRef.current;
    if (!ready || !video) return "rejected";
    const t0 = performance.now();
    const bmp = await cropForModel(video);
    const cropMs = performance.now() - t0;
    const r = await vision().recognize(transfer(bmp), packModeRef.current);
    const totalMs = performance.now() - t0;

    const t = timings.current;
    t.add("crop+recognize", totalMs);
    t.add("infer", r.timings.inferMs);
    t.add("search", r.timings.searchMs);
    if (r.timings.layoutMs > 0) t.add("layout", r.timings.layoutMs);

    setSt((s) => ({
      ...s,
      last: { ...r, cropMs, totalMs },
      summary: t.summary(),
      shownId: r.status === "accepted" ? r.best!.printingId : s.shownId,
      askOptions: r.status === "ask" ? r.askOptions ?? null : null,
      asks: s.asks + (r.status === "ask" ? 1 : 0),
    }));
    if (r.status !== "rejected") console.log("[vision]", r.status, r.reason, r.best?.printingId, r.timings);
    return r.status;
  }, [ready, videoRef]);

  /** User picked a printing in the chooser. Logged so frequent asks can be investigated. */
  const choose = useCallback((printingId: string) => {
    console.log("[vision] ask resolved by user:", printingId);
    setSt((s) => ({ ...s, shownId: printingId, askOptions: null }));
  }, []);

  return { ...st, ready, recognize, choose };
}

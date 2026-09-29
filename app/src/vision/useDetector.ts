// Main-thread side of the card detector (PLAN.md §5.7): loads it after the recognizer, then offers
// `detect()` on the current video frame. If detector.onnx is missing the app stays guide-box only.
import { type RefObject, useCallback, useEffect, useState } from "react";
import { CFG } from "../config";
import { transfer, vision } from "./client";
import type { DetectorInfo, DetectResult } from "./worker";

export function useDetector(videoRef: RefObject<HTMLVideoElement | null>, recognizerReady: boolean) {
  const [info, setInfo] = useState<DetectorInfo | null>(null);
  const [readyAtMs, setReadyAtMs] = useState<number | null>(null); // loaded (or known missing): cold start

  useEffect(() => {
    if (!recognizerReady) return;
    let live = true;
    void vision()
      .initDetector()
      .then((i) => {
        if (!live) return;
        setInfo(i);
        setReadyAtMs(performance.now());
        if (!i.available) console.info("[detect]", i.error);
      });
    return () => {
      live = false;
    };
  }, [recognizerReady]);

  const detect = useCallback(async (): Promise<DetectResult> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error("no video frame");
    // Raw (unmirrored) frame, stretched to the detector input like pipeline/detect_synth.py.
    const bmp = await createImageBitmap(video, {
      resizeWidth: CFG.DETECT_W,
      resizeHeight: CFG.DETECT_H,
      resizeQuality: "high",
    });
    return vision().detect(transfer(bmp));
  }, [videoRef]);

  return { info, readyAtMs, detect: info?.available ? detect : null };
}

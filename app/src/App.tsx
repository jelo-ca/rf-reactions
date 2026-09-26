import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { guideBoxVideoRect, type ObjectFit, videoRectToElement } from "./camera/guideBox";
import { useCamera } from "./camera/useCamera";
import { CFG } from "./config";
import { type RecognizeFn, useStability } from "./stability/useStability";
import { loadCards } from "./data/loaders";
import type { Card } from "./types";
import { CaptureMode } from "./ui/CaptureMode";
import { DebugPanel } from "./ui/DebugPanel";
import { usePackMode } from "./ui/usePackMode";

const FIT: ObjectFit = "cover";
const FLASH_MS = 600;

// Phase 2 stub: pretend recognition succeeds. Replaced by the vision worker in Phase 3.
const stubRecognize: RecognizeFn = () =>
  new Promise((resolve) => setTimeout(() => resolve("accepted"), CFG.STUB_RECOGNIZE_MS));

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [flash, setFlash] = useState(false);
  const [capture, setCapture] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const { packMode, togglePackMode } = usePackMode();
  const { stream, devices, error } = useCamera(deviceId);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    loadCards().then(setCards, (e: unknown) => setDataError(String(e)));
  }, []);

  const onReact = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), FLASH_MS);
  }, []);
  const { stats, captureBackground } = useStability(videoRef, !!stream, stubRecognize, onReact);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k === "d") setShowDebug((v) => !v);
      else if (k === "n") togglePackMode();
      else if (k === "b") captureBackground();
      else if (k === "m") setMirror((v) => !v);
      else if (k === "c") setCapture((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePackMode, captureBackground]);

  const { overlay, videoSize } = useGuideOverlay(videoRef, !!stream);
  const phase = stats.state.phase;
  const boxClass = flash ? "recognized" : phase === "CANDIDATE" ? "hold" : phase === "RECOGNIZING" ? "busy" : "idle";

  return (
    <div className="app">
      <header className="bar">
        <h1>Rift Pulls</h1>
        <label>
          Camera{" "}
          <select value={deviceId ?? ""} onChange={(e) => setDeviceId(e.target.value || null)}>
            <option value="">Default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={captureBackground} title="B">
          Capture empty background
        </button>
        <button type="button" onClick={togglePackMode} className={`pack pack-${packMode}`} title="N">
          {packMode === "booster" ? "Booster pack" : "Nexus Night pack"}
        </button>
        <label>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror
        </label>
      </header>

      <main className="stage">
        {(error || dataError) && <p className="error" role="alert">{error ?? dataError}</p>}
        <video ref={videoRef} autoPlay playsInline muted className={mirror ? "mirrored" : ""} style={{ objectFit: FIT }} />
        {overlay && (
          <div
            className={`guide ${boxClass}`}
            style={{ left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h }}
          >
            <span className="guide-label">
              {phase === "IDLE" && "Place card here"}
              {phase === "CANDIDATE" && "Hold still…"}
              {phase === "RECOGNIZING" && "Recognizing…"}
              {phase === "COOLDOWN" && (flash ? "Got it!" : "Remove card")}
            </span>
            {packMode === "nexus_night" && <span className="guide-badge">Nexus Night</span>}
          </div>
        )}
        {showDebug && !capture && <DebugPanel stats={stats} packMode={packMode} videoSize={videoSize} />}
        {capture && <CaptureMode cards={cards} videoRef={videoRef} />}
      </main>
      <footer className="keys">D debug · N pack mode · B background · M mirror · C capture mode</footer>
    </div>
  );
}

/** Guide box in element pixels; recomputed when the element or the video resolution changes. */
function useGuideOverlay(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean) {
  const [overlay, setOverlay] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    const update = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      const box = guideBoxVideoRect(vw, vh, CFG.GUIDE_HEIGHT_FRAC, CFG.MODEL_W, CFG.MODEL_H);
      setOverlay(videoRectToElement(box, vw, vh, video.clientWidth, video.clientHeight, FIT));
      setVideoSize({ w: vw, h: vh });
    };
    const ro = new ResizeObserver(update);
    ro.observe(video);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    update();
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [videoRef, active]);

  return { overlay, videoSize };
}

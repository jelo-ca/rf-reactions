import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { guideBoxVideoRect, type ObjectFit, videoRectToElement } from "./camera/guideBox";
import { useCamera } from "./camera/useCamera";
import { CFG } from "./config";
import { useStability } from "./stability/useStability";
import { loadCards, loadPrices } from "./data/loaders";
import type { Card } from "./types";
import { CaptureMode } from "./ui/CaptureMode";
import { DebugPanel } from "./ui/DebugPanel";
import { ResultChip } from "./ui/ResultChip";
import { usePackMode } from "./ui/usePackMode";
import { VariantChooser } from "./ui/VariantChooser";
import { useRecognizer } from "./vision/useRecognizer";

const FIT: ObjectFit = "cover";
const FLASH_MS = 600;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [flash, setFlash] = useState(false);
  const [capture, setCapture] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [dataError, setDataError] = useState<string | null>(null);
  const { packMode, togglePackMode } = usePackMode();
  const { stream, devices, error } = useCamera(deviceId);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    loadCards().then(setCards, (e: unknown) => setDataError(String(e)));
    loadPrices().then(
      (ps) => setPrices(new Map(ps.map((p) => [p.printingId, p.priceUsd]))),
      (e: unknown) => setDataError(String(e)),
    );
  }, []);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.printingId, c])), [cards]);

  const onReact = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), FLASH_MS);
  }, []);
  const rec = useRecognizer(videoRef, packMode);
  const { stats, captureBackground, pick } = useStability(videoRef, !!stream && rec.ready, rec.recognize, onReact);
  const onPick = useCallback(
    (printingId: string) => {
      rec.choose(printingId);
      pick();
    },
    [rec, pick],
  );

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
  const boxClass = flash
    ? "recognized"
    : phase === "CANDIDATE" ? "hold"
    : phase === "RECOGNIZING" || phase === "ASKING" ? "busy"
    : phase === "COOLDOWN" && stats.state.retries > CFG.RETRIES ? "failed"
    : "idle";
  const shown = rec.shownId && phase === "COOLDOWN" ? cardById.get(rec.shownId) : undefined;

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
        {(error || dataError || rec.initError) && (
          <p className="error" role="alert">{error ?? dataError ?? rec.initError}</p>
        )}
        {!rec.ready && !rec.initError && <p className="loading">Loading recognizer…</p>}
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
              {phase === "ASKING" && "Which one?"}
              {phase === "COOLDOWN" && (boxClass === "failed" ? "Not sure - try again" : flash ? "Got it!" : "Remove card")}
            </span>
            {packMode === "nexus_night" && <span className="guide-badge">Nexus Night</span>}
          </div>
        )}
        {shown && <ResultChip card={shown} price={prices.get(shown.printingId)} reason={rec.last?.reason} cardsByName={cards} prices={prices} />}
        {phase === "ASKING" && rec.askOptions && (
          <VariantChooser
            options={rec.askOptions.map((id) => cardById.get(id)).filter((c): c is Card => !!c)}
            prices={prices}
            onPick={onPick}
          />
        )}
        {showDebug && !capture && (
          <DebugPanel stats={stats} packMode={packMode} videoSize={videoSize} rec={rec} cardById={cardById} prices={prices} />
        )}
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

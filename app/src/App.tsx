import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { guideBoxVideoRect, type ObjectFit, videoRectToElement } from "./camera/guideBox";
import { useCamera } from "./camera/useCamera";
import { CFG } from "./config";
import { useStability } from "./stability/useStability";
import { loadCards, loadPrices, loadTiers } from "./data/loaders";
import { stageFx } from "./reactions/fx";
import { sampleCardForTier } from "./reactions/helpers";
import { StartScreen, TierDevPanel } from "./reactions/ReactionControls";
import { tierModeLabel, useTierMode } from "./reactions/useTierMode";
import { type Reaction, ReactionLayer } from "./reactions/ReactionLayer";
import { playTier, unlockAudio } from "./reactions/sounds";
import { resolveTier, type TierConfig } from "./reactions/tiers";
import type { Card, Price } from "./types";
import { CaptureMode } from "./ui/CaptureMode";
import { DebugPanel } from "./ui/DebugPanel";
import { PriceCard } from "./ui/PriceCard";
import { ResultChip } from "./ui/ResultChip";
import { usePackMode } from "./ui/usePackMode";
import { useRingLight } from "./ui/useRingLight";
import { VariantChooser } from "./ui/VariantChooser";
import { useRecognizer } from "./vision/useRecognizer";

const FIT: ObjectFit = "cover";
const FLASH_MS = 600;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const { ring, toggleRing } = useRingLight();
  const [showDebug, setShowDebug] = useState(true);
  const [flash, setFlash] = useState(false);
  const [capture, setCapture] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [priceById, setPriceById] = useState<Map<string, Price>>(new Map());
  const [dataError, setDataError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierConfig | null>(null);
  const [started, setStarted] = useState(false);
  const [showTierDev, setShowTierDev] = useState(false);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const cancelFx = useRef<() => void>(() => {});
  const reactionSeq = useRef(0);
  const { packMode, togglePackMode, packModeEnabled } = usePackMode();
  const { stream, devices, error } = useCamera(deviceId);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    loadCards().then(setCards, (e: unknown) => setDataError(String(e)));
    loadPrices().then(
      (ps) => setPriceById(new Map(ps.map((p) => [p.printingId, p]))),
      (e: unknown) => setDataError(String(e)),
    );
    loadTiers().then(setTiers, (e: unknown) => setDataError(String(e)));
  }, []);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.printingId, c])), [cards]);
  const prices = useMemo(() => new Map([...priceById].map(([id, p]) => [id, p.priceUsd])), [priceById]);

  const { tierMode, toggleTierMode } = useTierMode(tiers?.mode);

  /** Fire one reaction: stage fx + sound + overlay. The next one cancels this one's leftovers. */
  const fire = useCallback(
    (card: Card, tier: number) => {
      cancelFx.current();
      cancelFx.current = stageFx(tier, stageRef.current);
      void playTier(tier, tiers?.sounds[String(tier)]);
      setReaction({ id: ++reactionSeq.current, tier, card, priceUsd: prices.get(card.printingId) });
    },
    [tiers, prices],
  );

  const rec = useRecognizer(videoRef, packMode);
  const { shownRef } = rec;
  // Called by the state machine once per card hold (accept, or chooser pick): never twice.
  const onReact = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), FLASH_MS);
    const card = shownRef.current ? cardById.get(shownRef.current) : undefined;
    if (card && tiers) fire(card, resolveTier(card, prices.get(card.printingId), tiers, tierMode));
  }, [shownRef, cardById, tiers, prices, tierMode, fire]);
  const fireSample = useCallback(
    (tier: number) => {
      const card = tiers && sampleCardForTier(cards, prices, tiers, tierMode, tier);
      if (card) fire(card, tier);
      else console.warn(`[reactions] no card maps to tier ${tier} in ${tierMode} mode`);
    },
    [tiers, cards, prices, tierMode, fire],
  );
  const start = useCallback(() => {
    unlockAudio();
    setStarted(true);
  }, []);
  const { stats, rescan, pick } = useStability(videoRef, !!stream && rec.ready && started, rec.recognize, onReact);
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
      else if (k === "b") rescan();
      else if (k === "m") setMirror((v) => !v);
      else if (k === "c") setCapture((v) => !v);
      else if (k === "l") toggleRing();
      else if (k === "h") toggleTierMode();
      else if (k === "t") setShowTierDev((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePackMode, rescan, toggleRing, toggleTierMode]);

  const { overlay, videoSize } = useGuideOverlay(videoRef, !!stream, ring ? "ring" : "plain");
  const phase = stats.state.phase;
  const boxClass = flash
    ? "recognized"
    : phase === "CANDIDATE" ? "hold"
    : phase === "RECOGNIZING" || phase === "ASKING" ? "busy"
    : phase === "COOLDOWN" && stats.state.outcome === "unsure" ? "failed"
    : "idle";
  // Set on accept or chooser pick (when the reaction fires); kept until the next card replaces it.
  const shown = rec.shownId ? cardById.get(rec.shownId) : undefined;
  // Debug chip keeps the Phase 3 behaviour: only right after an accept, with that result's reason.
  const accepted = phase === "COOLDOWN" && stats.state.outcome === "accepted" ? shown : undefined;

  return (
    <div className={ring ? "app ring-on" : "app"}>
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
        <button type="button" onClick={rescan} title="B: check the current view again">
          Rescan
        </button>
        {packModeEnabled && (
          <button type="button" onClick={togglePackMode} className={`pack pack-${packMode}`} title="N">
            {packMode === "booster" ? "Booster pack" : "Nexus Night pack"}
          </button>
        )}
        {tiers && (
          <button type="button" onClick={toggleTierMode} className={`tier-mode tier-mode-${tierMode}`} title="H">
            {tierModeLabel(tierMode)}
          </button>
        )}
        <label>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror
        </label>
        <button type="button" role="switch" aria-checked={ring} onClick={toggleRing} title="L" className="ring-toggle">
          <span className="switch" aria-hidden="true" /> Ring light {ring ? "on" : "off"}
        </button>
      </header>

      <main className="stage" ref={stageRef}>
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
              {phase === "COOLDOWN" && (boxClass === "failed" ? "Not sure - adjust the card" : flash ? "Got it!" : "Next card")}
            </span>
            {packMode === "nexus_night" && <span className="guide-badge">Nexus Night</span>}
          </div>
        )}
        {shown && <PriceCard key={shown.printingId} card={shown} cards={cards} prices={priceById} />}
        <ReactionLayer reaction={reaction} onDismiss={() => setReaction(null)} />
        {showTierDev && tiers && (
          <TierDevPanel names={tiers.names} mode={tierMode} onFire={fireSample} onToggleMode={toggleTierMode} />
        )}
        {!started && <StartScreen onStart={start} />}
        {phase === "ASKING" && rec.askOptions && (
          <VariantChooser
            options={rec.askOptions.map((id) => cardById.get(id)).filter((c): c is Card => !!c)}
            prices={prices}
            onPick={onPick}
          />
        )}
        {showDebug && !capture && accepted && (
          <ResultChip card={accepted} price={prices.get(accepted.printingId)} reason={rec.last?.reason} cardsByName={cards} prices={prices} />
        )}
        {showDebug && !capture && (
          <DebugPanel stats={stats} packMode={packMode} videoSize={videoSize} rec={rec} cardById={cardById} prices={prices} />
        )}
        {capture && <CaptureMode cards={cards} videoRef={videoRef} />}
      </main>
      <footer className="keys">D debug{packModeEnabled ? " · N pack mode" : ""} · H hype mode · T tiers · B rescan · M mirror · C capture mode · L ring light</footer>
    </div>
  );
}

/** Guide box in element pixels; recomputed when the element or the video resolution changes. */
function useGuideOverlay(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean, layoutKey: string) {
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
      const r = videoRectToElement(box, vw, vh, video.clientWidth, video.clientHeight, FIT);
      // The overlay is positioned in the stage; the video may be inset (ring light padding).
      setOverlay({ ...r, x: r.x + video.offsetLeft, y: r.y + video.offsetTop });
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
  }, [videoRef, active, layoutKey]);

  return { overlay, videoSize };
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { guideBoxVideoRect, type ObjectFit, type StageTransform, videoRectToElement, videoToElementTransform } from "./camera/guideBox";
import { useCamera } from "./camera/useCamera";
import { CFG } from "./config";
import { useStability } from "./stability/useStability";
import { loadCards, loadPrices, loadTiers } from "./data/loaders";
import { stageFx } from "./reactions/fx";
import { sampleCardForTier } from "./reactions/helpers";
import { TierDevPanel } from "./reactions/ReactionControls";
import { tierModeLabel, useTierMode } from "./reactions/useTierMode";
import { type Reaction, ReactionLayer } from "./reactions/ReactionLayer";
import { playTier, unlockAudio } from "./reactions/sounds";
import { resolveTier, type TierConfig } from "./reactions/tiers";
import { isRepeat } from "./reactions/helpers";
import {
  loadPriceLimits, priceLimits, priceTiersJson, savePriceLimits, tierCounts, withPriceLimits,
} from "./reactions/tierTuning";
import type { Card, Price } from "./types";
import { AppFooter } from "./ui/AppFooter";
import { CaptureMode } from "./ui/CaptureMode";
import { DebugPanel } from "./ui/DebugPanel";
import { DetectionOverlay } from "./ui/DetectionOverlay";
import { downloadJson } from "./ui/download";
import { PriceCard } from "./ui/PriceCard";
import { ResultChip } from "./ui/ResultChip";
import { ShortcutsOverlay } from "./ui/ShortcutsOverlay";
import { StartScreen } from "./ui/StartScreen";
import { latestAsOf, modelsReady, startupSteps } from "./ui/startup";
import { usePackMode } from "./ui/usePackMode";
import { useRingLight } from "./ui/useRingLight";
import { VariantChooser } from "./ui/VariantChooser";
import { useDetector } from "./vision/useDetector";
import { useRecognizer } from "./vision/useRecognizer";

const FIT: ObjectFit = "cover";
// Built for imajello.com/projects/rift-pulls (npm run build:site): show a link back to the site.
const ON_SITE = import.meta.env.BASE_URL !== "/";
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
  const [dataAtMs, setDataAtMs] = useState<number | null>(null);
  const [baseTiers, setBaseTiers] = useState<TierConfig | null>(null); // public/data/tiers.json
  const [limitOverride, setLimitOverride] = useState<number[] | null>(() => loadPriceLimits());
  const [started, setStarted] = useState(false);
  const [showTierDev, setShowTierDev] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
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
    const cardsP = loadCards().then(setCards, (e: unknown) => setDataError(String(e)));
    const pricesP = loadPrices().then(
      (ps) => setPriceById(new Map(ps.map((p) => [p.printingId, p]))),
      (e: unknown) => setDataError(String(e)),
    );
    const tiersP = loadTiers().then(setBaseTiers, (e: unknown) => setDataError(String(e)));
    void Promise.all([cardsP, pricesP, tiersP]).then(() => setDataAtMs(performance.now()));
  }, []);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.printingId, c])), [cards]);
  const prices = useMemo(() => new Map([...priceById].map(([id, p]) => [id, p.priceUsd])), [priceById]);

  // Thresholds tuned in the tier panel (T) override tiers.json in this browser; a stale/invalid saved
  // override (e.g. tiers.json changed its tier count) is ignored.
  const tiers = useMemo(() => {
    if (!baseTiers || !limitOverride) return baseTiers;
    try {
      return withPriceLimits(baseTiers, limitOverride);
    } catch {
      return baseTiers;
    }
  }, [baseTiers, limitOverride]);
  const setLimits = useCallback((limits: number[] | null) => {
    setLimitOverride(limits);
    savePriceLimits(limits);
  }, []);
  const { tierMode, toggleTierMode } = useTierMode(tiers?.mode);
  const counts = useMemo(
    () => (tiers ? tierCounts(cards, prices, tiers, tierMode) : []),
    [tiers, cards, prices, tierMode],
  );

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
  const { shownRef, logReaction } = rec;
  const lastReacted = useRef<string | null>(null);
  // Called by the state machine once per card hold (accept, or chooser pick). The same printing twice
  // in a row doesn't react again (owner, 2026-09-28): guards against double reactions for one card.
  const onReact = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), FLASH_MS);
    const card = shownRef.current ? cardById.get(shownRef.current) : undefined;
    if (!card || !tiers) return;
    if (CFG.SKIP_REPEAT_REACTION && isRepeat(lastReacted.current, card.printingId)) {
      console.info("[reactions] same card as last time, no reaction:", card.printingId);
      return;
    }
    lastReacted.current = card.printingId;
    const tier = resolveTier(card, prices.get(card.printingId), tiers, tierMode);
    logReaction(card.printingId, tier);
    fire(card, tier);
  }, [shownRef, cardById, tiers, prices, tierMode, fire, logReaction]);
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
  const detector = useDetector(videoRef, rec.ready);
  // The middle guide box is gone when the detector is loaded (owner, 2026-09-28): the card can be
  // anywhere. It comes back, as box + fallback region, only if the detector model is missing.
  const guideMode = detector.info !== null && !detector.info.available;
  const { stats, rescan, pick } = useStability(
    videoRef, !!stream && rec.ready && started, rec.recognize, onReact, detector.detect, guideMode,
  );
  const { overlay, videoSize, xf } = useGuideOverlay(videoRef, !!stream, ring ? "ring" : "plain");
  // Loading screen steps; cold start = navigation start → data + both models ready (§10 acceptance).
  const steps = startupSteps({
    data: cards.length > 0 && priceById.size > 0 && !!baseTiers,
    dataError,
    recognizer: rec.info,
    recognizerError: rec.initError,
    detector: detector.info,
    camera: !!stream,
    cameraError: error,
  });
  const ready = modelsReady(steps);
  const coldStartMs = ready ? Math.max(dataAtMs ?? 0, rec.readyAtMs ?? 0, detector.readyAtMs ?? 0) : null;
  const asOf = useMemo(() => latestAsOf(priceById.values()), [priceById]);

  const exportSession = useCallback(() => {
    const data = rec.session.toExport({
      userAgent: navigator.userAgent,
      coldStartMs,
      recognizer: rec.info,
      detector: detector.info,
      video: videoSize,
      fps: stats.fps,
      cameraFps: stats.cameraFps,
      frameWorkMs: stats.frameWork,
      tierMode,
      packMode,
      pricesAsOf: asOf,
      config: CFG,
    });
    downloadJson(`rift-pulls-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, data);
  }, [rec.session, rec.info, coldStartMs, detector.info, videoSize, stats.fps, stats.cameraFps, stats.frameWork, tierMode, packMode, asOf]);

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
      if (k === "?") setShowKeys((v) => !v);
      else if (k === "escape") setShowKeys(false);
      else if (k === "d") setShowDebug((v) => !v);
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

  const phase = stats.state.phase;
  const boxClass = flash
    ? "recognized"
    : phase === "CANDIDATE" ? "hold"
    : phase === "RECOGNIZING" || phase === "ASKING" ? "busy"
    : phase === "COOLDOWN" && stats.state.outcome === "unsure" ? "failed"
    : "idle";
  const noCard = !guideMode && stats.detection.source === "none";
  const status =
    phase === "CANDIDATE" ? "Hold still…"
    : phase === "RECOGNIZING" ? "Recognizing…"
    : phase === "ASKING" ? "Which one?"
    : phase === "COOLDOWN" && boxClass === "failed" ? "Not sure - adjust the card"
    : phase === "COOLDOWN" && flash ? "Got it!"
    : noCard ? "Show a card"
    : phase === "COOLDOWN" ? "Next card"
    : guideMode ? "Place card here" : "Show a card";
  // Set on accept or chooser pick (when the reaction fires); kept until the next card replaces it.
  const shown = rec.shownId ? cardById.get(rec.shownId) : undefined;
  // Debug chip keeps the Phase 3 behaviour: only right after an accept, with that result's reason.
  const accepted = phase === "COOLDOWN" && stats.state.outcome === "accepted" ? shown : undefined;

  return (
    <div className={ring ? "app ring-on" : "app"}>
      <header className="bar">
        {ON_SITE && (
          <a className="home-link" href="/" title="Back to imajello.com">
            ← imajello.com
          </a>
        )}
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
        <video ref={videoRef} autoPlay playsInline muted className={mirror ? "mirrored" : ""} style={{ objectFit: FIT }} />
        {guideMode && overlay && (
          <div
            className={`guide ${boxClass}`}
            style={{ left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h }}
          >
            <span className="guide-label">{status}</span>
            {packMode === "nexus_night" && <span className="guide-badge">Nexus Night</span>}
          </div>
        )}
        {!guideMode && started && (
          <div className={`status-pill ${boxClass}`} role="status">
            {status}
            {packMode === "nexus_night" && <span className="guide-badge">Nexus Night</span>}
          </div>
        )}
        {shown && <PriceCard key={shown.printingId} card={shown} cards={cards} prices={priceById} />}
        <ReactionLayer reaction={reaction} onDismiss={() => setReaction(null)} />
        {showTierDev && tiers && (
          <TierDevPanel
            names={tiers.names}
            mode={tierMode}
            limits={priceLimits(tiers)}
            defaults={baseTiers ? priceLimits(baseTiers) : priceLimits(tiers)}
            counts={counts}
            json={priceTiersJson(tiers)}
            onFire={fireSample}
            onToggleMode={toggleTierMode}
            onLimits={setLimits}
          />
        )}
        {!started && <StartScreen steps={steps} onStart={start} />}
        {showKeys && <ShortcutsOverlay packMode={packModeEnabled} onClose={() => setShowKeys(false)} />}
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
        {showDebug && !capture && <DetectionOverlay detection={stats.detection} xf={xf} mirrored={mirror} />}
        {showDebug && !capture && (
          <DebugPanel
            stats={stats} packMode={packMode} videoSize={videoSize} rec={rec} detector={detector.info} cardById={cardById}
            prices={prices} session={rec.session} coldStartMs={coldStartMs} onExport={exportSession}
          />
        )}
        {capture && <CaptureMode cards={cards} videoRef={videoRef} guideMode={guideMode} quad={stats.detection.quad} />}
      </main>
      <AppFooter asOf={asOf} onShortcuts={() => setShowKeys(true)} />
    </div>
  );
}

/** Guide box in element pixels; recomputed when the element or the video resolution changes. */
function useGuideOverlay(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean, layoutKey: string) {
  const [overlay, setOverlay] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [xf, setXf] = useState<StageTransform | null>(null);

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
      const t = videoToElementTransform(vw, vh, video.clientWidth, video.clientHeight, FIT);
      setXf({ ...t, left: video.offsetLeft, top: video.offsetTop, elW: video.clientWidth });
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

  return { overlay, videoSize, xf };
}

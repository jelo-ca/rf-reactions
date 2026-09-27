// Small UI pieces for Phase 5: the tier dev panel (T) and "Click to start".
import type { TierMode } from "./tiers";
import { tierModeLabel } from "./useTierMode";

interface DevProps {
  names: readonly string[];
  mode: TierMode;
  onFire: (tier: number) => void;
  onToggleMode: () => void;
}

/** T: fire any tier on demand (PLAN §8 acceptance), with a real card from that tier. */
export function TierDevPanel({ names, mode, onFire, onToggleMode }: DevProps) {
  return (
    <div className="tier-dev" role="toolbar" aria-label="Reaction tiers">
      <b>Tiers</b>
      {names.map((n, i) => (
        <button key={n} type="button" onClick={() => onFire(i)}>
          {i} · {n}
        </button>
      ))}
      <button type="button" onClick={onToggleMode} title="H">
        {tierModeLabel(mode)}
      </button>
    </div>
  );
}

/** Browsers only allow sound after a user gesture, so the app starts with one click. */
export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="start-screen">
      <button type="button" onClick={onStart} autoFocus>
        Click to start
      </button>
      <p>Turns on the camera loop and the (very professional) reaction sounds.</p>
    </div>
  );
}

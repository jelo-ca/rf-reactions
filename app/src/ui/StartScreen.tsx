// Loading screen + "Click to start" (browsers only allow sound after a user gesture). PLAN.md §10.2.
import { modelsReady, type Step } from "./startup";

const ICON: Record<Step["state"], string> = { loading: "…", done: "✓", off: "–", error: "✕" };

export function StartScreen({ steps, onStart }: { steps: Step[]; onStart: () => void }) {
  const ready = modelsReady(steps);
  const done = steps.filter((s) => s.state !== "loading").length;
  return (
    <div className="start-screen">
      <h2>Rift Pulls</h2>
      <ul className="steps" aria-live="polite">
        {steps.map((s) => (
          <li key={s.label} className={`step ${s.state}`}>
            <span className="step-icon" aria-hidden="true">{ICON[s.state]}</span>
            <span>{s.label}</span>
            {s.detail && <span className="step-detail">{s.detail}</span>}
          </li>
        ))}
      </ul>
      <progress max={steps.length} value={done} />
      <button type="button" onClick={onStart} disabled={!ready} autoFocus>
        {ready ? "Click to start" : "Loading…"}
      </button>
      <p>Turns on the camera loop and the (very professional) reaction sounds.</p>
    </div>
  );
}

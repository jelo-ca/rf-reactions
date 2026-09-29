// Loading screen steps + footer helpers (PLAN.md §10.2). Pure; unit tested.
import type { Price } from "../types";

export interface Step {
  label: string;
  state: "loading" | "done" | "off" | "error"; // off = optional part missing, app still works
  detail?: string;
}

export interface StartupInputs {
  data: boolean; // cards + prices + tiers loaded
  dataError: string | null;
  recognizer: { backend: string; loadMs: number } | null;
  recognizerError: string | null;
  detector: { available: boolean; backend?: string; loadMs?: number } | null;
  camera: boolean;
  cameraError: string | null;
}

const secs = (v: number | undefined) => (v === undefined ? "" : ` · ${(v / 1000).toFixed(1)} s`);

export function startupSteps(i: StartupInputs): Step[] {
  const step = (label: string, done: boolean, error: string | null, detail?: string): Step =>
    error ? { label, state: "error", detail: error } : { label, state: done ? "done" : "loading", detail: done ? detail : undefined };
  const detector: Step =
    i.detector === null
      ? { label: "Card detector", state: i.recognizerError ? "error" : "loading" }
      : i.detector.available
        ? { label: "Card detector", state: "done", detail: `${i.detector.backend}${secs(i.detector.loadMs)}` }
        : { label: "Card detector", state: "off", detail: "no model - guide box instead" };
  return [
    step("Card data + prices", i.data, i.dataError),
    step("Recognizer model", !!i.recognizer, i.recognizerError, i.recognizer ? `${i.recognizer.backend}${secs(i.recognizer.loadMs)}` : undefined),
    detector,
    step("Camera", i.camera, i.cameraError),
  ];
}

/** Everything that has to load before the first pull (the camera can still be warming up). */
export const modelsReady = (steps: readonly Step[]) =>
  steps.filter((s) => s.label !== "Camera").every((s) => s.state === "done" || s.state === "off");

/** Newest price snapshot date (YYYY-MM-DD), for the footer credit. */
export function latestAsOf(prices: Iterable<Price>): string | null {
  let best: string | null = null;
  for (const p of prices) if (p.asOf && (best === null || p.asOf > best)) best = p.asOf;
  return best && best.slice(0, 10);
}

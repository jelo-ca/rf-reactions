import { describe, expect, it } from "vitest";
import { latestAsOf, modelsReady, type StartupInputs, startupSteps } from "./startup";

const base: StartupInputs = {
  data: false, dataError: null, recognizer: null, recognizerError: null, detector: null, camera: false, cameraError: null,
};

describe("startupSteps", () => {
  it("starts with everything loading", () => {
    const steps = startupSteps(base);
    expect(steps.map((s) => s.state)).toEqual(["loading", "loading", "loading", "loading"]);
    expect(modelsReady(steps)).toBe(false);
  });

  it("is ready once data + models are in, camera not required", () => {
    const steps = startupSteps({
      ...base, data: true, recognizer: { backend: "webgpu", loadMs: 1800 }, detector: { available: true, backend: "webgpu", loadMs: 400 },
    });
    expect(steps[1].detail).toBe("webgpu · 1.8 s");
    expect(modelsReady(steps)).toBe(true);
  });

  it("a missing detector is optional", () => {
    const steps = startupSteps({ ...base, data: true, recognizer: { backend: "wasm", loadMs: 1 }, detector: { available: false } });
    expect(steps[2].state).toBe("off");
    expect(modelsReady(steps)).toBe(true);
  });

  it("errors block and are shown", () => {
    const steps = startupSteps({ ...base, data: true, recognizerError: "boom" });
    expect(steps[1]).toEqual({ label: "Recognizer model", state: "error", detail: "boom" });
    expect(steps[2].state).toBe("error"); // the detector never loads without the recognizer
    expect(modelsReady(steps)).toBe(false);
  });
});

describe("latestAsOf", () => {
  it("picks the newest date", () => {
    const p = (asOf: string) => ({ printingId: "x", priceUsd: 1, source: "tcgcsv", asOf });
    expect(latestAsOf([p("2026-09-20"), p("2026-09-25"), p("")])).toBe("2026-09-25");
    expect(latestAsOf([])).toBeNull();
  });
});

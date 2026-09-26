// Mirrors pipeline/tests/test_packmode.py — keep the two in sync.
import { describe, expect, it } from "vitest";
import { allowed, filterCandidates, loadPackMode, nextPackMode, pickSamePicture, savePackMode } from "./packMode";
import type { PackMode } from "../types";

const card = (printingId: string, pool: "booster" | "nexus_night" = "booster") => ({ printingId, pool });
const BASE = card("OGN-066");
const FOIL = card("OGN-066F");
const NN = card("OPP-066", "nexus_night");
const PRICES = new Map([["OGN-066", 0.5], ["OGN-066F", 2.0], ["OPP-066", 4.0]]);

describe("pack mode", () => {
  it("booster mode excludes Nexus Night printings", () => {
    expect(allowed(NN, "booster")).toBe(false);
    expect(allowed(BASE, "booster")).toBe(true);
    expect(filterCandidates([BASE, FOIL, NN], "booster")).toEqual([BASE, FOIL]);
  });

  it("nexus_night mode keeps everything", () => {
    expect(filterCandidates([BASE, FOIL, NN], "nexus_night")).toEqual([BASE, FOIL, NN]);
  });

  it("booster mode picks the cheapest booster printing", () => {
    expect(pickSamePicture([BASE, FOIL, NN], PRICES, "booster")).toBe(BASE);
  });

  it("nexus_night mode prefers the promo even if pricier", () => {
    expect(pickSamePicture([BASE, FOIL, NN], PRICES, "nexus_night")).toBe(NN);
  });

  it("nexus_night mode falls back when the group has no promo", () => {
    expect(pickSamePicture([BASE, FOIL], PRICES, "nexus_night")).toBe(BASE);
  });

  it("booster mode with only a promo throws", () => {
    expect(() => pickSamePicture([NN], PRICES, "booster")).toThrow(/no allowed printing/);
  });

  it("rejects unknown modes", () => {
    expect(() => allowed(BASE, "prerelease" as PackMode)).toThrow(/unknown pack mode/);
  });

  it("breaks price ties by id for determinism", () => {
    const a = card("A-1");
    const b = card("A-2");
    expect(pickSamePicture([b, a], new Map([["A-1", 1], ["A-2", 1]]), "booster")).toBe(a);
  });
});

describe("pack mode setting", () => {
  const memStore = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("defaults to booster, round-trips, and toggles", () => {
    const s = memStore();
    expect(loadPackMode(s)).toBe("booster");
    savePackMode("nexus_night", s);
    expect(loadPackMode(s)).toBe("nexus_night");
    expect(nextPackMode("nexus_night")).toBe("booster");
  });

  it("survives broken or missing storage", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPackMode(throwing)).toBe("booster");
    expect(() => savePackMode("nexus_night", throwing)).not.toThrow();
    expect(loadPackMode(undefined)).toBe("booster");
    expect(loadPackMode({ getItem: () => "garbage" })).toBe("booster");
  });
});

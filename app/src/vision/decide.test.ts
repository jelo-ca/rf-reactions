import { describe, expect, it } from "vitest";
import type { Card, PackMode } from "../types";
import { type DecideConfig, decide, indexCards } from "./decide";

const cfg: DecideConfig = { ACCEPT_T: 0.75, MARGIN_T: 0.05, EMBED_WEIGHT: 0.5, LAYOUT_WEIGHT: 0.5, LAYOUT_MARGIN_T: 0.03 };

const card = (printingId: string, name: string, imageHash: string, extra: Partial<Card> = {}): Card => ({
  printingId, name, imageHash, setCode: printingId.split("-")[0], collectorNumber: "001", rarity: "Rare",
  variant: "normal", imageUrl: "", pool: "booster", ...extra,
});

const ALL = [
  card("OGN-001", "Solo", "s1"),
  card("OGN-002", "Other", "o1"),
  // same picture: normal + foil + Nexus Night promo reusing the art
  card("OGN-066", "Ahri", "a1"),
  card("OGN-066F", "Ahri", "a1", { variant: "foil" }),
  card("OPP-066", "Ahri", "a1", { variant: "promo", pool: "nexus_night", setCode: "OPP" }),
  // different pictures: base vs alt art
  card("OGN-117", "Viktor", "v1"),
  card("OGN-117A", "Viktor", "v2", { variant: "alt_art" }),
];
const { cards, byName } = indexCards(ALL);
const prices = new Map([
  ["OGN-001", 1], ["OGN-002", 1], ["OGN-066", 0.5], ["OGN-066F", 2], ["OPP-066", 300],
  ["OGN-117", 0.3], ["OGN-117A", 40],
]);

function run(scores: Record<string, number>, layout: Record<string, number> = {}, packMode: PackMode = "booster") {
  return decide(
    { scores: new Map(Object.entries(scores)), cards, byName, prices, packMode,
      layoutScoreFor: (id) => (id in layout ? layout[id] : null) },
    cfg,
  );
}

describe("decide — step A (which card)", () => {
  it("rejects low scores", () => {
    const r = run({ "OGN-001": 0.6, "OGN-002": 0.2 });
    expect(r).toMatchObject({ status: "rejected", reason: "low_score" });
  });

  it("rejects a low margin against a different card name", () => {
    const r = run({ "OGN-001": 0.9, "OGN-002": 0.88 });
    expect(r).toMatchObject({ status: "rejected", reason: "low_margin" });
  });

  it("ignores same-name printings when measuring the margin", () => {
    const r = run({ "OGN-117": 0.9, "OGN-117A": 0.89, "OGN-002": 0.5 }, { "OGN-117": 0.9, "OGN-117A": 0.5 });
    expect(r.status).toBe("accepted");
  });

  it("accepts a card with a single printing", () => {
    const r = run({ "OGN-001": 0.9, "OGN-002": 0.5 });
    expect(r).toMatchObject({ status: "accepted", reason: "ok", best: { printingId: "OGN-001" } });
    expect(r.top.map((m) => m.printingId)).toEqual(["OGN-001", "OGN-002"]);
  });

  it("rejects when nothing is allowed", () => {
    expect(run({})).toMatchObject({ status: "rejected", reason: "low_score" });
  });
});

describe("decide — step B (which printing)", () => {
  it("same picture → cheapest, marked same_image_cheapest (foil and NN excluded in booster mode)", () => {
    const r = run({ "OGN-066": 0.9, "OPP-066": 0.9, "OGN-002": 0.4 });
    expect(r).toMatchObject({ status: "accepted", reason: "same_image_cheapest", best: { printingId: "OGN-066" } });
    expect(r.top.map((m) => m.printingId)).not.toContain("OPP-066");
  });

  it("nexus_night mode picks the Nexus Night promo in a same-picture group", () => {
    const r = run({ "OGN-066": 0.9, "OPP-066": 0.9, "OGN-002": 0.4 }, {}, "nexus_night");
    expect(r).toMatchObject({ status: "accepted", best: { printingId: "OPP-066" }, packMode: "nexus_night" });
  });

  it("different pictures → layout resolves when the combined margin is large enough", () => {
    const r = run({ "OGN-117": 0.85, "OGN-117A": 0.84, "OGN-002": 0.3 }, { "OGN-117": 0.4, "OGN-117A": 0.9 });
    expect(r).toMatchObject({ status: "accepted", reason: "layout_resolved", best: { printingId: "OGN-117A" } });
    expect(r.layout?.map((l) => l.printingId).sort()).toEqual(["OGN-117", "OGN-117A"]);
  });

  it("different pictures, too close → ask with both options", () => {
    const r = run({ "OGN-117": 0.85, "OGN-117A": 0.85, "OGN-002": 0.3 }, { "OGN-117": 0.7, "OGN-117A": 0.71 });
    expect(r).toMatchObject({ status: "ask", reason: "layout_ambiguous" });
    expect([...(r.askOptions ?? [])].sort()).toEqual(["OGN-117", "OGN-117A"]);
  });

  it("never picks the cheapest across different pictures", () => {
    // alt art clearly wins on layout; base is far cheaper — must still pick the alt art
    const r = run({ "OGN-117": 0.8, "OGN-117A": 0.82, "OGN-002": 0.3 }, { "OGN-117": 0.2, "OGN-117A": 0.95 });
    expect(r.best?.printingId).toBe("OGN-117A");
  });
});

import { describe, expect, it } from "vitest";
import type { Card, Price } from "../types";
import { findFoilSibling, formatAsOf, formatUsd, priceCardView, variantLabel } from "./priceCard";

const card = (printingId: string, extra: Partial<Card> = {}): Card => ({
  printingId, name: "Ahri", setCode: "OGN", setName: "Origins", collectorNumber: "066", rarity: "Rare",
  variant: "normal", imageHash: "a1", imageUrl: `/data/images/${printingId}.jpg`, pool: "booster", ...extra,
});
const price = (printingId: string, priceUsd: number, asOf = "2026-09-25T20:05:42Z"): Price =>
  ({ printingId, priceUsd, source: "tcgcsv", asOf });
const byId = (...ps: Price[]) => new Map(ps.map((p) => [p.printingId, p]));

describe("formatUsd", () => {
  it("formats dollars with cents and thousands separators", () => {
    expect(formatUsd(0.05)).toBe("$0.05");
    expect(formatUsd(3)).toBe("$3.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("shows a dash instead of crashing on a missing or bad price", () => {
    for (const v of [undefined, NaN, Infinity, -1]) expect(formatUsd(v)).toBe("—");
  });
});

describe("formatAsOf", () => {
  it("shows the snapshot date in UTC", () => {
    expect(formatAsOf("2026-09-25T20:05:42Z")).toBe("Sep 25, 2026");
    expect(formatAsOf("2026-09-25T23:59:59Z")).toBe("Sep 25, 2026"); // not the next day in UTC+ zones
  });
  it("returns null when missing or unparsable", () => {
    expect(formatAsOf(undefined)).toBeNull();
    expect(formatAsOf("")).toBeNull();
    expect(formatAsOf("yesterday-ish")).toBeNull();
  });
});

describe("variantLabel", () => {
  it("names every variant", () => {
    expect(variantLabel("normal")).toBe("Normal");
    expect(variantLabel("foil")).toBe("Foil");
    expect(variantLabel("alt_art")).toBe("Alt art");
    expect(variantLabel("promo")).toBe("Promo");
  });
});

describe("findFoilSibling", () => {
  const base = card("OGN-066");
  const foil = card("OGN-066F", { variant: "foil" });
  const alt = card("OGN-066a", { variant: "alt_art", imageHash: "b2" });
  const altFoil = card("OGN-066aF", { variant: "foil", imageHash: "b2" });
  const other = card("OGN-001", { name: "Blazing Scorcher", variant: "foil" });
  const cards = [base, foil, alt, altFoil, other];

  it("finds the foil with the same name and picture", () => {
    expect(findFoilSibling(base, cards)).toBe(foil);
    expect(findFoilSibling(alt, cards)).toBe(altFoil);
  });
  it("ignores other pictures and other names", () => {
    expect(findFoilSibling(card("X", { imageHash: "zz" }), cards)).toBeUndefined();
    expect(findFoilSibling(card("Y", { name: "Other" }), cards)).toBeUndefined();
  });
  it("gives no hint for a card that is already the foil", () => {
    expect(findFoilSibling(foil, cards)).toBeUndefined();
  });
  it("hints at the base's foil for a Nexus Night promo reusing the base picture", () => {
    const nn = card("OPP-066", { setCode: "OPP", variant: "promo", pool: "nexus_night" });
    expect(findFoilSibling(nn, [...cards, nn])).toBe(foil);
  });
});

describe("priceCardView", () => {
  const base = card("OGN-066");
  const foil = card("OGN-066F", { variant: "foil" });
  const cards = [base, foil];

  it("builds everything the card shows", () => {
    expect(priceCardView(base, cards, byId(price("OGN-066", 1.5), price("OGN-066F", 12)))).toEqual({
      imageUrl: "/data/images/OGN-066.jpg",
      name: "Ahri",
      set: "Origins · #066",
      variant: "Normal",
      price: "$1.50",
      hasPrice: true,
      asOf: "Sep 25, 2026",
      foilHint: "could be foil: $12.00",
      nexusNight: false,
    });
  });
  it("marks Nexus Night printings", () => {
    const nn = card("OPP-066", { setCode: "OPP", pool: "nexus_night", variant: "promo" });
    expect(priceCardView(nn, [nn], byId()).nexusNight).toBe(true);
  });
  it("falls back to the set code when there is no set name", () => {
    expect(priceCardView(card("A", { setName: "" }), [], byId()).set).toBe("OGN · #066");
  });
  it("degrades gracefully when prices are missing", () => {
    const v = priceCardView(base, cards, byId());
    expect(v.price).toBe("—");
    expect(v.hasPrice).toBe(false);
    expect(v.asOf).toBeNull();
    expect(v.foilHint).toBe("could be foil");
  });
  it("shows no foil hint for the foil itself", () => {
    expect(priceCardView(foil, cards, byId(price("OGN-066F", 12))).foilHint).toBeNull();
  });
});

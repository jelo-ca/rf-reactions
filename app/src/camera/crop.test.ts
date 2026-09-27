import { describe, expect, it } from "vitest";
import { captureFileName } from "./crop";
import { searchCards } from "../data/loaders";
import type { Card } from "../types";

describe("captureFileName", () => {
  it("matches the pattern sort_eval.py expects", () => {
    const f = captureFileName("OGN-007A", new Date("2026-09-26T10:15:00.123Z"));
    expect(f).toBe("OGN-007A__20260926T101500Z.png");
    expect(f).toMatch(/^[A-Z0-9]+-[A-Z0-9]+__\d{8}T\d{6}Z\.png$/);
  });
});

describe("searchCards", () => {
  const c = (printingId: string, name: string): Card => ({
    printingId, name, setCode: printingId.split("-")[0], setName: "Set", collectorNumber: "001", rarity: "Rare",
    variant: "normal", imageHash: "h", imageUrl: "", pool: "booster",
  });
  const cards = [c("OGN-066", "Ahri - Alluring"), c("OGN-255", "Ahri - Nine-Tailed Fox"), c("SFD-099", "Veteran Poro")];

  it("matches all terms across name and id, ignoring case and punctuation", () => {
    expect(searchCards(cards, "ahri").map((x) => x.printingId)).toEqual(["OGN-066", "OGN-255"]);
    expect(searchCards(cards, "nine tailed").map((x) => x.printingId)).toEqual(["OGN-255"]);
    expect(searchCards(cards, "sfd-099").map((x) => x.printingId)).toEqual(["SFD-099"]);
    expect(searchCards(cards, "  ")).toEqual([]);
  });
});

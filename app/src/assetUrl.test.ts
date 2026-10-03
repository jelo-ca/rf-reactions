import { describe, expect, it } from "vitest";
import { assetUrl } from "./assetUrl";

describe("assetUrl", () => {
  it("keeps root-relative paths at the default base", () => {
    expect(assetUrl("/data/cards.json", "/")).toBe("/data/cards.json");
  });
  it("prefixes a sub-path base", () => {
    expect(assetUrl("/data/images/OGN-001.jpg", "/projects/rift-pulls/")).toBe("/projects/rift-pulls/data/images/OGN-001.jpg");
    expect(assetUrl("models/x.onnx", "/projects/rift-pulls")).toBe("/projects/rift-pulls/models/x.onnx");
  });
  it("leaves absolute URLs alone", () => {
    expect(assetUrl("https://cdn.example/x.png", "/sub/")).toBe("https://cdn.example/x.png");
    expect(assetUrl("blob:abc", "/sub/")).toBe("blob:abc");
  });
});

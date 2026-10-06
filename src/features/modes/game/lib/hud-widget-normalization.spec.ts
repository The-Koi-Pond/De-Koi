import { describe, expect, it } from "vitest";
import { findWidgetStatIndex } from "./hud-widget-normalization";

describe("findWidgetStatIndex", () => {
  const stats = [{ name: "👻 Columbina" }, { name: "🃏 Harlequin" }, { name: "Columbina's Echo" }];

  it("matches a stat whose decorative emoji the GM left out", () => {
    expect(findWidgetStatIndex(stats, "Columbina")).toBe(0);
    expect(findWidgetStatIndex(stats, " harlequin ")).toBe(1);
  });

  it("prefers an exact name and never matches a different stat", () => {
    expect(findWidgetStatIndex(stats, "Columbina's Echo")).toBe(2);
    expect(findWidgetStatIndex(stats, "Pierrot")).toBe(-1);
    expect(findWidgetStatIndex(stats, "👻")).toBe(-1);
  });
});

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

  it("changes nothing when the loose match is ambiguous", () => {
    const colliding = [{ name: "🔥 Rage" }, { name: "💢 Rage" }, { name: "HP" }, { name: "❤️ HP" }];
    expect(findWidgetStatIndex(colliding, "Rage")).toBe(-1);
    expect(findWidgetStatIndex(colliding, "HP")).toBe(2);
    expect(findWidgetStatIndex(colliding, "hp")).toBe(-1);
  });
});

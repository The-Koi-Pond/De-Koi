import { describe, expect, it } from "vitest";
import { mergedGroupDisplayLabel, mergedGroupNames } from "./merged-group-label";

describe("merged group labels", () => {
  it("uses the active character names for merged roleplay replies", () => {
    const names = mergedGroupNames(["harlequin", "jester", "pierrot"], new Map([
      ["harlequin", { name: "Harlequin" }],
      ["jester", { name: "Jester" }],
      ["pierrot", { name: "Pierrot" }],
    ]));

    expect(names).toEqual(["Harlequin", "Jester", "Pierrot"]);
    expect(mergedGroupDisplayLabel(names)).toBe("Harlequin, Jester, Pierrot");
  });

  it("falls back to a neutral group label when names are unavailable", () => {
    expect(mergedGroupNames(["missing"], new Map())).toEqual([]);
    expect(mergedGroupDisplayLabel([])).toBe("Group");
  });
});

import { describe, expect, it } from "vitest";

import { matchedBatchGrid, matchedOverallGrid, planMatchedBatches } from "./matched-batches";
import { chipLabel, countLabel, defaultPicks, gridForCount, togglePick } from "./sprite-lists";
import {
  listFormName,
  matchedExpressionNames,
  namesReplacingSaved,
  nameOptions,
  replaceSavedQuestion,
  normalizeSpriteName,
  savableName,
  saveSpriteName,
  spriteNameOptions,
} from "./sprite-names";

describe("counts and picks", () => {
  it("labels each count with its grid as columns × rows", () => {
    expect([1, 6, 9, 12, 16].map((count) => countLabel(count as 1))).toEqual([
      "1 (1×1)",
      "6 (2×3)",
      "9 (3×3)",
      "12 (3×4)",
      "16 (4×4)",
    ]);
    expect(gridForCount(12)).toEqual({ cols: 3, rows: 4 });
  });

  it("has a default expression and pose list per count", () => {
    expect(defaultPicks("expressions", 6)).toEqual(["neutral", "happy", "sad", "angry", "surprised", "smirk"]);
    expect(defaultPicks("full-body", 6)).toEqual(["idle", "walk", "battle_stance", "casting", "defend", "victory"]);
    expect(defaultPicks("expressions", 12).slice(9)).toEqual(["crying", "determined", "confused"]);
    expect(defaultPicks("full-body", 9)).toEqual([
      "idle",
      "walk",
      "run",
      "battle_stance",
      "attack",
      "defend",
      "casting",
      "hurt",
      "victory",
    ]);
    expect(defaultPicks("full-body", 16)).toHaveLength(16);
    expect(defaultPicks("expressions", 1)).toEqual(["neutral"]);
  });

  it("removes a picked chip, replaces the only pick on 1×1, and drops the oldest when the grid is full", () => {
    expect(togglePick(["a", "b"], "a", 6)).toEqual(["b"]);
    expect(togglePick(["neutral"], "happy", 1)).toEqual(["happy"]);
    expect(togglePick(["a", "b"], "c", 6)).toEqual(["a", "b", "c"]);
    expect(togglePick(["a", "b", "c", "d", "e", "f"], "g", 6)).toEqual(["b", "c", "d", "e", "f", "g"]);
  });

  it("shows chips with spaces and a capital first letter", () => {
    expect(chipLabel("battle_stance")).toBe("Battle stance");
  });
});

describe("names", () => {
  it("applies the rename rule: trimmed, lowercased, other characters as _", () => {
    expect(normalizeSpriteName("  Very Happy! ")).toBe("very_happy_");
    expect(normalizeSpriteName("ok-name_2")).toBe("ok-name_2");
    expect(normalizeSpriteName("   ")).toBe("");
  });

  it("saves full-body names with one full_ prefix and portrait names without it", () => {
    expect(saveSpriteName("idle", "full-body")).toBe("full_idle");
    expect(saveSpriteName("full_idle", "full-body")).toBe("full_idle");
    expect(saveSpriteName("Full_Idle", "expressions")).toBe("idle");
    expect(saveSpriteName("Very Happy", "expressions")).toBe("very_happy");
  });

  it("treats a name the save rule empties as no name", () => {
    expect(savableName("full_", "expressions")).toBeNull();
    expect(savableName("FULL_", "expressions")).toBeNull();
    expect(savableName("  ", "full-body")).toBeNull();
    expect(savableName("full_", "full-body")).toBe("full_");
    expect(savableName("Happy", "full-body")).toBe("full_happy");
  });

  it("cleans and deduplicates the existing portrait names for matched batches", () => {
    expect(matchedExpressionNames(["neutral", "Happy", "very sad", "neutral", "full_idle", "  ", "happy"])).toEqual([
      "neutral",
      "happy",
      "very_sad",
      "idle",
    ]);
  });

  it("offers the generation's names, then the full list, in list form without repeats", () => {
    expect(nameOptions(["happy", "full_wave"], "poses").slice(0, 4)).toEqual(["happy", "wave", "idle", "walk"]);
    expect(nameOptions(["happy"], "expressions")).toHaveLength(16);
    expect(spriteNameOptions("Odd Name", ["happy"])).toEqual(["odd_name", "happy"]);
    expect(spriteNameOptions("happy", ["happy"])).toEqual(["happy"]);
    expect(listFormName("full_Idle")).toBe("idle");
  });
});

describe("matched batches", () => {
  it("splits names into batches of four with their own grids", () => {
    const batches = planMatchedBatches(["a", "b", "c", "d", "e", "f"]);
    expect(batches).toEqual([
      { names: ["a", "b", "c", "d"], grid: { cols: 2, rows: 2 } },
      { names: ["e", "f"], grid: { cols: 2, rows: 1 } },
    ]);
    expect(matchedBatchGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(matchedBatchGrid(3)).toEqual({ cols: 2, rows: 2 });
  });

  it("reviews all matched sprites in a grid that follows the number of names", () => {
    const grids = [1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 16].map((count) => matchedOverallGrid(count));
    expect(grids.map(({ cols, rows }) => `${cols}x${rows}`)).toEqual([
      "1x1",
      "2x1",
      "3x1",
      "2x2",
      "3x2",
      "3x2",
      "3x3",
      "3x3",
      "4x3",
      "4x3",
      "4x4",
      "4x4",
    ]);
  });
});

describe("replacing saved sprites", () => {
  it("finds save names the owner already has, case-insensitively, once each and in save order", () => {
    expect(namesReplacingSaved(["sad", "happy", "happy", "full_idle", ""], ["HAPPY", "full_idle", "angry"])).toEqual([
      "happy",
      "full_idle",
    ]);
    expect(namesReplacingSaved(["happy"], [])).toEqual([]);
  });

  it("asks in plain words and lists at most six names", () => {
    expect(replaceSavedQuestion(["happy"])).toBe("Replace 1 saved sprite: happy?");
    expect(replaceSavedQuestion(["a", "b", "c", "d", "e", "f", "g", "h"])).toBe(
      "Replace 8 saved sprites: a, b, c, d, e, f and 2 more?",
    );
  });
});

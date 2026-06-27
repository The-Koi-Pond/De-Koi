import { describe, expect, it } from "vitest";
import type { DekiEntryAction } from "../../../../engine/deki/deki-entry";
import { createDekiActionDiffRows } from "./deki-action-diff";

describe("createDekiActionDiffRows", () => {
  it("shows create action fields as added rows", () => {
    const action: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {
        name: "Sol",
        description: "Sunny traveler",
      },
    };

    expect(createDekiActionDiffRows(action)).toEqual([
      expect.objectContaining({
        path: "name",
        before: null,
        after: "Sol",
        status: "added",
        inlineDiff: [{ text: "Sol", kind: "added" }],
      }),
      expect.objectContaining({
        path: "description",
        before: null,
        after: "Sunny traveler",
        status: "added",
        inlineDiff: [{ text: "Sunny traveler", kind: "added" }],
      }),
    ]);
  });

  it("compares nested proposed edit fields against JSON-string current data", () => {
    const action: DekiEntryAction = {
      type: "edit_record",
      entity: "characters",
      id: "character-1",
      patch: {
        data: {
          personality: "Warm, focused, and direct.",
          scenario: "Runs a quiet repair shop.",
        },
      },
    };
    const rows = createDekiActionDiffRows(action, {
      id: "character-1",
      data: JSON.stringify({
        personality: "Warm, focused, and playful.",
        scenario: "Runs a quiet repair shop.",
      }),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        path: "data.personality",
        before: "Warm, focused, and playful.",
        after: "Warm, focused, and direct.",
        status: "changed",
      }),
      expect.objectContaining({
        path: "data.scenario",
        before: "Runs a quiet repair shop.",
        after: "Runs a quiet repair shop.",
        status: "unchanged",
      }),
    ]);
    expect(rows[0]?.inlineDiff).toEqual([
      expect.objectContaining({ text: "Warm, focused, and ", kind: "unchanged" }),
      expect.objectContaining({ text: "playful", kind: "removed" }),
      expect.objectContaining({ text: "direct", kind: "added" }),
      expect.objectContaining({ text: ".", kind: "unchanged" }),
    ]);
  });
});

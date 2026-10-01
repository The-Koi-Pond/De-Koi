import { describe, expect, it } from "vitest";
import type { DekiEntryAction } from "../../../../engine/deki/deki-entry";
import {
  createDekiActionDiffRows,
  createDekiDeletePreviewFields,
  createDekiRowChangeDiffRows,
} from "./deki-action-diff";

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

  it("skips empty object containers instead of rendering root placeholder rows", () => {
    const emptyCreateAction: DekiEntryAction = {
      type: "create_record",
      entity: "personas",
      draft: {},
    };
    const nestedEmptyPatchAction: DekiEntryAction = {
      type: "edit_record",
      entity: "characters",
      id: "character-1",
      patch: {
        data: {},
        name: "Sol",
      },
    };

    expect(createDekiActionDiffRows(emptyCreateAction)).toEqual([]);
    expect(createDekiActionDiffRows(nestedEmptyPatchAction, { id: "character-1", name: "Sola" })).toEqual([
      expect.objectContaining({
        path: "name",
        before: "Sola",
        after: "Sol",
        status: "changed",
      }),
    ]);
  });

  it("skips malformed scalar root payloads instead of rendering root placeholder rows", () => {
    const scalarCreateAction = {
      type: "create_record",
      entity: "personas",
      draft: "Sol",
    } as unknown as DekiEntryAction;

    expect(createDekiActionDiffRows(scalarCreateAction)).toEqual([]);
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

  it("recursively normalizes mixed JSON-string current branches before comparing nested leaves", () => {
    const action: DekiEntryAction = {
      type: "edit_record",
      entity: "characters",
      id: "character-1",
      patch: {
        data: {
          profile: {
            tastes: {
              music: "classical piano",
            },
          },
        },
      },
    };
    const rows = createDekiActionDiffRows(action, {
      id: "character-1",
      data: JSON.stringify({
        profile: JSON.stringify({
          tastes: JSON.stringify({
            music: "old film scores",
          }),
        }),
      }),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        path: "data.profile.tastes.music",
        before: "old film scores",
        after: "classical piano",
        status: "changed",
      }),
    ]);
  });

  it("normalizes only the traversed current branch when siblings use different shapes", () => {
    const action: DekiEntryAction = {
      type: "edit_record",
      entity: "characters",
      id: "character-1",
      patch: {
        data: {
          profile: {
            tastes: {
              music: "classical piano",
            },
          },
          metadata: {
            source: "manual",
          },
        },
      },
    };
    const rows = createDekiActionDiffRows(action, {
      id: "character-1",
      data: {
        profile: JSON.stringify({
          tastes: JSON.stringify({
            music: "old film scores",
          }),
        }),
        metadata: {
          source: "manual",
          imported: true,
        },
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        path: "data.profile.tastes.music",
        before: "old film scores",
        after: "classical piano",
        status: "changed",
      }),
      expect.objectContaining({
        path: "data.metadata.source",
        before: "manual",
        after: "manual",
        status: "unchanged",
      }),
    ]);
  });
});

describe("createDekiDeletePreviewFields", () => {
  it("summarizes a deleted record without ids, timestamps, or JSON list syntax", () => {
    const fields = createDekiDeletePreviewFields({
      entity: "lorebook-entries",
      id: "entry-koi",
      action: "delete",
      before: {
        id: "entry-koi",
        lorebookId: "book-pond",
        name: "Koi (copy)",
        keys: ["koi", "carp"],
        content: "x".repeat(400),
        createdAt: "2026-06-25T12:00:00.000Z",
        folderId: "",
      },
    });

    expect(fields.map((field) => field.label)).toEqual(["name", "keys", "content"]);
    expect(fields[1]!.value).toBe("koi, carp");
    expect(fields[2]!.value.length).toBe(280);
    expect(fields[2]!.value.endsWith("...")).toBe(true);
  });
});

describe("inline diff word boundaries", () => {
  it("shows a changed word whole instead of splitting it at shared letters", () => {
    const [row] = createDekiRowChangeDiffRows({
      entity: "lorebook-entries",
      id: "entry-koi",
      action: "update",
      before: { content: "The koi circle the lantern at dusk." },
      after: { content: "The koi circle the lantern at dawn, when the pond is cold." },
    });

    expect(row?.inlineDiff).toEqual([
      { text: "The koi circle the lantern at ", kind: "unchanged" },
      { text: "dusk", kind: "removed" },
      { text: "dawn, when the pond is cold", kind: "added" },
      { text: ".", kind: "unchanged" },
    ]);
  });
});

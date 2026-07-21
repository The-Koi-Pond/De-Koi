import { describe, expect, it, vi } from "vitest";
import { applySTBulkImportInvalidations } from "./st-bulk-import-invalidations";
import type { STBulkImportedCounts } from "./st-bulk-import-model";

function imported(overrides: Partial<STBulkImportedCounts>): STBulkImportedCounts {
  return {
    characters: 0,
    chats: 0,
    groupChats: 0,
    presets: 0,
    lorebooks: 0,
    backgrounds: 0,
    personas: 0,
    ...overrides,
  };
}

function invalidatedKeysFor(counts: STBulkImportedCounts): unknown[][] {
  const invalidateQueries = vi.fn();
  applySTBulkImportInvalidations({ invalidateQueries }, counts);
  return invalidateQueries.mock.calls.map(([options]) => options.queryKey as unknown[]);
}

describe("applySTBulkImportInvalidations", () => {
  it("invalidates every affected catalog owner", () => {
    expect(
      invalidatedKeysFor(
        imported({
          characters: 1,
          chats: 2,
          groupChats: 3,
          presets: 4,
          lorebooks: 5,
          backgrounds: 6,
          personas: 7,
        }),
      ),
    ).toEqual([
      ["characters", "presence"],
      ["characters", "list"],
      ["characters", "summaries"],
      ["characters", "library-summaries"],
      ["characters", "panel-summaries"],
      ["chats", "list"],
      ["lorebooks"],
      ["presets"],
      ["personas", "presence"],
      ["personas"],
      ["personas", "summaries"],
      ["personas", "active-summary"],
      ["backgrounds"],
      ["background-tags"],
    ]);
  });

  it("uses group chats to refresh the chat list without unrelated invalidations", () => {
    expect(invalidatedKeysFor(imported({ groupChats: 1 }))).toEqual([["chats", "list"]]);
  });

  it("skips empty imported categories", () => {
    expect(invalidatedKeysFor(imported({}))).toEqual([]);
  });
});

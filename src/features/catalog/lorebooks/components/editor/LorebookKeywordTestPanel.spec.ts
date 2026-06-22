import { describe, expect, it } from "vitest";
import type { LorebookActivationTraceEntry } from "../../../../../engine/contracts/types/lorebook";
import { getKeywordTraceSummary } from "./LorebookKeywordTestPanel";

function trace(entryId: string, status: LorebookActivationTraceEntry["status"]): LorebookActivationTraceEntry {
  return {
    entryId,
    lorebookId: "book-1",
    name: entryId,
    status,
    reason: status === "included" ? "keyword_match" : "primary_key_miss",
    hint: "hint",
    matchedKeys: status === "included" ? ["key"] : [],
    tokenEstimate: 1,
    injection: {
      position: 0,
      role: "system",
      depth: 4,
      order: 1,
    },
  };
}

describe("getKeywordTraceSummary", () => {
  it("reports zero visible rows when the entry filter hides every trace row", () => {
    const summary = getKeywordTraceSummary([trace("entry-1", "included")], [], 0);

    expect(summary.displayedMatchCount).toBe(0);
    expect(summary.enabledEntryCount).toBe(0);
    expect(summary.includedCount).toBe(0);
    expect(summary.skippedCount).toBe(0);
    expect(summary.traceScopeLabel).toBe("Visible trace");
  });

  it("uses the same visible subset for numerator and denominator", () => {
    const summary = getKeywordTraceSummary(
      [trace("entry-1", "included"), trace("entry-2", "skipped"), trace("entry-3", "included")],
      ["entry-1", "entry-2"],
      2,
    );

    expect(summary.displayedMatchCount).toBe(1);
    expect(summary.enabledEntryCount).toBe(2);
    expect(summary.includedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.traceScopeLabel).toBe("Visible trace");
  });
});
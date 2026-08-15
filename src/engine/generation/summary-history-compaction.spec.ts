import { describe, expect, it } from "vitest";

import type { ChatMLMessage } from "../contracts/types/prompt";
import { compactHistorySelectionForCoveredSummaries } from "./summary-history-compaction";

function message(id: string): { prompt: ChatMLMessage; source: Record<string, unknown> } {
  return {
    prompt: { role: "user", content: id, contextKind: "history" },
    source: { id, role: "user", content: id },
  };
}

function compact(ids: string[], coveredMessageIds: string[], tailMessages = 2) {
  const entries = ids.map(message);
  return compactHistorySelectionForCoveredSummaries({
    messages: entries.map((entry) => entry.prompt),
    sourceMessages: entries.map((entry) => entry.source),
    coveredMessageIds,
    tailMessages,
  });
}

describe("compactHistorySelectionForCoveredSummaries", () => {
  it("removes a covered contiguous prefix while retaining the recent causal tail", () => {
    const result = compact(["m1", "m2", "m3", "m4"], ["m1", "m2", "m3"]);

    expect(result.messages.map((entry) => entry.content)).toEqual(["m3", "m4"]);
    expect(result.sourceMessages.map((entry) => entry.id)).toEqual(["m3", "m4"]);
    expect(result.compactedCount).toBe(2);
    expect(result.coversPriorHistory).toBe(true);
  });

  it("leaves history untouched when summary coverage has a gap", () => {
    const result = compact(["m1", "m2", "m3", "m4"], ["m1", "m3"], 1);

    expect(result.messages.map((entry) => entry.content)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(result.compactedCount).toBe(0);
    expect(result.coversPriorHistory).toBe(false);
  });

  it("combines projected coverage ids", () => {
    const result = compact(["m1", "m2", "m3", "m4"], ["m1", "m2"], 1);

    expect(result.messages.map((entry) => entry.content)).toEqual(["m3", "m4"]);
    expect(result.compactedCount).toBe(2);
  });

  it("fails closed for missing ids, mismatched arrays, and summaries without message coverage", () => {
    const normal = compact(["m1", "m2"], []);
    expect(normal.compactedCount).toBe(0);
    expect(normal.coversPriorHistory).toBe(false);

    const mismatched = compactHistorySelectionForCoveredSummaries({
      messages: [{ role: "user", content: "m1" }],
      sourceMessages: [],
      coveredMessageIds: ["m1"],
      tailMessages: 0,
    });
    expect(mismatched.compactedCount).toBe(0);
    expect(mismatched.messages).toHaveLength(1);
  });
});

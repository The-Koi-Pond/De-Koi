import { describe, expect, it } from "vitest";

import { appendChatSummaryEntryToMetadata, normalizeChatSummaryMetadata } from "./chat-summary-entries";

describe("chat summary entries", () => {
  it("keeps malformed imported summary entries marked as legacy", () => {
    const normalized = normalizeChatSummaryMetadata({
      summaryEntries: [{ id: "old-summary", content: "An imported summary without origin." }],
    });

    expect(normalized.entries).toHaveLength(1);
    expect(normalized.entries[0]).toMatchObject({
      id: "old-summary",
      origin: "legacy",
      sourceMode: "last",
      title: "Legacy summary",
      content: "An imported summary without origin.",
    });
    expect(normalized.summary).toBe("An imported summary without origin.");
  });

  it("still marks new appended summaries as manual by default", () => {
    const appended = appendChatSummaryEntryToMetadata({}, { content: "A new manually entered summary." });

    expect(appended.entry).toMatchObject({
      origin: "manual",
      sourceMode: "last",
      title: "Manual summary",
      content: "A new manually entered summary.",
    });
    expect(appended.summary).toBe("A new manually entered summary.");
  });
});

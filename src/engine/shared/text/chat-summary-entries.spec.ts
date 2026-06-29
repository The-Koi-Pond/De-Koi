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

  it("preserves full-chat source metadata on generated summary entries", () => {
    const appended = appendChatSummaryEntryToMetadata(
      {},
      { content: "A generated full-roleplay summary.", sourceMode: "all", messageCount: 12 },
    );

    expect(appended.entry).toMatchObject({
      origin: "manual",
      sourceMode: "all",
      messageCount: 12,
      title: "Summary of 12 messages",
    });
  });

  it("unwraps model JSON summary responses before storing entry content", () => {
    const appended = appendChatSummaryEntryToMetadata(
      {},
      {
        content: [
          "```json",
          "{",
          '  "summary": "The user and character discuss control. The character stays nearby as the user falls asleep."',
          "}",
          "```",
        ].join("\n"),
      },
    );

    expect(appended.entry.content).toBe(
      "The user and character discuss control. The character stays nearby as the user falls asleep.",
    );
    expect(appended.summary).toBe(
      "The user and character discuss control. The character stays nearby as the user falls asleep.",
    );
  });

  it("does not duplicate legacy summary metadata after unwrapping model JSON", () => {
    const wrapped = [
      "```json",
      "{",
      '  "summary": "The user and character discuss control. The character stays nearby as the user falls asleep."',
      "}",
      "```",
    ].join("\n");

    const normalized = normalizeChatSummaryMetadata({
      summary: wrapped,
      summaryEntries: [{ id: "generated-summary", content: wrapped, origin: "manual" }],
    });

    expect(normalized.entries).toHaveLength(1);
    expect(normalized.entries[0]?.content).toBe(
      "The user and character discuss control. The character stays nearby as the user falls asleep.",
    );
    expect(normalized.summary).toBe(
      "The user and character discuss control. The character stays nearby as the user falls asleep.",
    );
  });
});

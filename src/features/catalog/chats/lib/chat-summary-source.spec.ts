import { describe, expect, it } from "vitest";
import type { Message, MessageExtra } from "../../../../engine/contracts/types/chat";
import { selectChatSummarySourceMessages } from "./chat-summary-source";

const baseExtra: MessageExtra = {
  displayText: null,
  isGenerated: false,
  tokenCount: null,
  generationInfo: null,
};

function message(id: string, createdAt: string, content = id): Message {
  return {
    id,
    chatId: "chat-1",
    role: "user",
    characterId: null,
    content,
    activeSwipeIndex: 0,
    createdAt,
    extra: baseExtra,
  };
}

describe("selectChatSummarySourceMessages", () => {
  it("selects the full transcript chronologically for full-history summaries", () => {
    const newestFirst = [
      message("m4", "2026-06-01T00:00:04.000Z"),
      message("m3", "2026-06-01T00:00:03.000Z"),
      message("m2", "2026-06-01T00:00:02.000Z"),
      message("m1", "2026-06-01T00:00:01.000Z"),
    ];

    const selected = selectChatSummarySourceMessages(newestFirst, { limit: 2, sourceMode: "all" });

    expect(selected.sourceMode).toBe("all");
    expect(selected.messages.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });
  it("selects the latest messages chronologically even when storage returns newest first", () => {
    const newestFirst = [
      message("m5", "2026-06-01T00:00:05.000Z"),
      message("m4", "2026-06-01T00:00:04.000Z"),
      message("m3", "2026-06-01T00:00:03.000Z"),
      message("m2", "2026-06-01T00:00:02.000Z"),
      message("m1", "2026-06-01T00:00:01.000Z"),
    ];

    const selected = selectChatSummarySourceMessages(newestFirst, { limit: 3 });

    expect(selected.messages.map((row) => row.id)).toEqual(["m3", "m4", "m5"]);
  });

  it("treats manual ranges as chronological 1-based message numbers", () => {
    const newestFirst = [
      message("m4", "2026-06-01T00:00:04.000Z"),
      message("m3", "2026-06-01T00:00:03.000Z"),
      message("m2", "2026-06-01T00:00:02.000Z"),
      message("m1", "2026-06-01T00:00:01.000Z"),
    ];

    const selected = selectChatSummarySourceMessages(newestFirst, { limit: 50, rangeStartIndex: 2, rangeEndIndex: 3 });

    expect(selected.messages.map((row) => row.id)).toEqual(["m2", "m3"]);
    expect(selected.rangeStartIndex).toBe(2);
    expect(selected.rangeEndIndex).toBe(3);
  });

  it("excludes hidden and blank messages after selecting the requested source window", () => {
    const selected = selectChatSummarySourceMessages(
      [
        message("m1", "2026-06-01T00:00:01.000Z", "one"),
        { ...message("m2", "2026-06-01T00:00:02.000Z", "two"), extra: { ...baseExtra, hiddenFromAI: true } },
        message("m3", "2026-06-01T00:00:03.000Z", "   "),
        message("m4", "2026-06-01T00:00:04.000Z", "four"),
      ],
      { limit: 4 },
    );

    expect(selected.messages.map((row) => row.id)).toEqual(["m1", "m4"]);
  });
});

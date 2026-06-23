import { describe, expect, it } from "vitest";

import { buildSaveMomentLoreDraft } from "./save-moment-lore-draft";

describe("save moment lore draft", () => {
  it("builds a lorebook entry draft with source chat and message metadata", () => {
    const draft = buildSaveMomentLoreDraft({
      chatId: "chat-7",
      messageId: "msg-42",
      role: "assistant",
      speakerName: "Deki",
      createdAt: "2026-06-23T15:40:00.000Z",
      content: "The lighthouse finally answered back.",
    });

    expect(draft).toEqual({
      name: "Moment from Deki",
      description: "Drafted from assistant message msg-42 in chat chat-7.",
      content: "The lighthouse finally answered back.",
      keys: [],
      sourceChatId: "chat-7",
      sourceMessageId: "msg-42",
    });
  });

  it("uses a generic name when the source has no speaker", () => {
    const draft = buildSaveMomentLoreDraft({
      chatId: "chat-7",
      messageId: "msg-42",
      role: "assistant",
      content: "The archive door opens only for the sea bell.",
    });

    expect(draft.name).toBe("Moment from assistant");
  });
});

import { describe, expect, it } from "vitest";

import { conversationTypingLabel, resolveConversationRegenerationDisplay } from "./conversation-streaming-draft";

describe("conversation regeneration clean-final contract", () => {
  it("keeps saved content visible underneath active regeneration feedback", () => {
    const display = resolveConversationRegenerationDisplay({
      isRegenerating: true,
      savedMessageContent: "Old complete response.",
      savedContentParts: ["Old complete response."],
    });

    expect(display.messageContent).toBe("Old complete response.");
    expect(display.contentParts).toEqual(["Old complete response."]);
    expect(display.showActiveRegeneration).toBe(true);
  });
});

describe("conversation typing label", () => {
  it("says recording a voice message while the reply is a voice note", () => {
    expect(conversationTypingLabel("Mira", false)).toBe("Mira is typing...");
    expect(conversationTypingLabel("Mira", true)).toBe("Mira is recording a voice message...");
    expect(conversationTypingLabel("Mira, Bea", false)).toBe("Mira, Bea are typing...");
  });
});

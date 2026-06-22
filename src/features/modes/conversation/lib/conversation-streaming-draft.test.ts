import { describe, expect, it } from "vitest";

import { resolveConversationRegenerationDisplay } from "./conversation-streaming-draft";

describe("conversation regeneration clean-final contract", () => {
  it("does not carry saved content parts into an active regeneration placeholder", () => {
    const display = resolveConversationRegenerationDisplay({
      isRegenerating: true,
      savedMessageContent: "Old complete response.",
      savedContentParts: ["Old complete response."],
    });

    expect(display.messageContent).toBe("");
    expect(display.contentParts).toBeUndefined();
    expect(display.showActiveRegeneration).toBe(true);
  });
});

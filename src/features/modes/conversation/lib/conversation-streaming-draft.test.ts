import { describe, expect, it } from "vitest";

import { resolveConversationRegenerationDisplay } from "./conversation-streaming-draft";

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

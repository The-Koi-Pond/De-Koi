import { describe, expect, it } from "vitest";

import { resolveConversationStatusDisplay } from "./conversation-status-display";

describe("resolveConversationStatusDisplay", () => {
  it("hides stored status blurbs when the chat opt-in is off", () => {
    expect(
      resolveConversationStatusDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        { conversationStatusMessagesEnabled: false },
      ),
    ).toEqual({
      conversationStatusMessage: undefined,
      conversationActivity: "sorting notes",
    });
  });

  it("keeps the generated blurb when the chat opt-in is on", () => {
    expect(
      resolveConversationStatusDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        { conversationStatusMessagesEnabled: true },
      ),
    ).toEqual({
      conversationStatusMessage: "quietly reading",
      conversationActivity: "sorting notes",
    });
  });
});

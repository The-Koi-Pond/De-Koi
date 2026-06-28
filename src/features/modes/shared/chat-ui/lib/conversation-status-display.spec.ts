import { describe, expect, it } from "vitest";

import { resolveConversationStatusDisplay } from "./conversation-status-display";

describe("resolveConversationStatusDisplay", () => {
  it("hides stored generated status blurbs and legacy activity when the chat opt-in is off", () => {
    expect(
      resolveConversationStatusDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        { conversationStatusMessagesEnabled: false },
      ),
    ).toEqual({
      conversationStatusMessage: undefined,
      conversationActivity: undefined,
    });
  });

  it("keeps generated blurbs when the global default is on and the chat has no explicit override", () => {
    expect(
      resolveConversationStatusDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        {},
        true,
      ),
    ).toEqual({
      conversationStatusMessage: "quietly reading",
      conversationActivity: "sorting notes",
    });
  });
  it("keeps generated blurbs and legacy activity when the chat opt-in is on", () => {
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

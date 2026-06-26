import { describe, expect, it } from "vitest";

import { resolveConversationLegacyActivityDisplay, resolveConversationStatusBlurbDisplay } from "./conversation-status-display";

describe("resolveConversationStatusBlurbDisplay", () => {
  it("hides stored generated status blurbs when the chat opt-in is off", () => {
    expect(
      resolveConversationStatusBlurbDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        { conversationStatusMessagesEnabled: false },
      ),
    ).toEqual({
      conversationStatusMessage: undefined,
    });
  });

  it("keeps the generated blurb when the chat opt-in is on", () => {
    expect(
      resolveConversationStatusBlurbDisplay(
        { conversationStatusMessage: "quietly reading", conversationActivity: "sorting notes" },
        { conversationStatusMessagesEnabled: true },
      ),
    ).toEqual({
      conversationStatusMessage: "quietly reading",
    });
  });
  it("keeps legacy activity on an explicit compatibility display path", () => {
    expect(
      resolveConversationLegacyActivityDisplay({
        conversationStatusMessage: "quietly reading",
        conversationActivity: "sorting notes",
      }),
    ).toEqual({
      conversationActivity: "sorting notes",
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolveConversationStatusMessagesEnabled } from "./conversation-status-settings";

describe("resolveConversationStatusMessagesEnabled", () => {
  it("uses the global default when a chat has no explicit status blurb setting", () => {
    expect(resolveConversationStatusMessagesEnabled({}, true)).toBe(true);
    expect(resolveConversationStatusMessagesEnabled({}, false)).toBe(false);
  });

  it("lets explicit chat metadata override the global default", () => {
    expect(resolveConversationStatusMessagesEnabled({ conversationStatusMessagesEnabled: true }, false)).toBe(true);
    expect(resolveConversationStatusMessagesEnabled({ conversationStatusMessagesEnabled: false }, true)).toBe(false);
  });
});

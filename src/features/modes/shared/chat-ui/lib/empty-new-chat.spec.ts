import { describe, expect, it } from "vitest";

import { isAbandonedChatDraft } from "./empty-new-chat";

const draft = {
  activeChatId: "chat-1",
  setupChatId: null,
  chatCharIds: [],
  totalMessageCount: 0,
  messagesLoaded: true,
  wizardOpen: false,
};

describe("isAbandonedChatDraft", () => {
  it("flags a chat left with no characters and no messages", () => {
    expect(isAbandonedChatDraft(draft)).toBe(true);
  });

  it("stays quiet while setup is running or the chat is in use", () => {
    expect(isAbandonedChatDraft({ ...draft, wizardOpen: true })).toBe(false);
    expect(isAbandonedChatDraft({ ...draft, setupChatId: "chat-1" })).toBe(false);
    expect(isAbandonedChatDraft({ ...draft, chatCharIds: ["harlequin"] })).toBe(false);
    expect(isAbandonedChatDraft({ ...draft, totalMessageCount: 1 })).toBe(false);
  });

  it("waits for messages to load before deciding", () => {
    expect(isAbandonedChatDraft({ ...draft, messagesLoaded: false })).toBe(false);
  });
});

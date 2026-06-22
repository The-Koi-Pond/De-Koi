import { describe, expect, it } from "vitest";

import {
  resolveConversationRegenerationDisplay,
  shouldShowConversationTypingIndicator,
} from "./conversation-streaming-draft";

describe("conversation clean response display", () => {
  it("keeps active regeneration feedback without rendering partial replacement text", () => {
    expect(
      resolveConversationRegenerationDisplay({
        isRegenerating: true,
        savedMessageContent: "Saved response.",
        savedContentParts: ["Saved response."],
      }),
    ).toEqual({
      messageContent: "",
      contentParts: undefined,
      showActiveRegeneration: true,
    });
  });

  it("leaves completed conversation text alone when no regeneration is active", () => {
    expect(
      resolveConversationRegenerationDisplay({
        isRegenerating: false,
        savedMessageContent: "Saved response.",
        savedContentParts: ["Saved response."],
      }),
    ).toEqual({
      messageContent: "Saved response.",
      contentParts: ["Saved response."],
      showActiveRegeneration: false,
    });
  });

  it("shows typing feedback for hidden classic streaming text", () => {
    expect(
      shouldShowConversationTypingIndicator({
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        messageStyle: "classic",
      }),
    ).toBe(true);
  });

  it("does not show standalone typing feedback for delayed, idle, or bubble states", () => {
    expect(
      shouldShowConversationTypingIndicator({
        isStreaming: false,
        hasDelayedCharacterInfo: false,
        messageStyle: "classic",
      }),
    ).toBe(false);
    expect(
      shouldShowConversationTypingIndicator({
        isStreaming: true,
        hasDelayedCharacterInfo: true,
        messageStyle: "classic",
      }),
    ).toBe(false);
    expect(
      shouldShowConversationTypingIndicator({
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        messageStyle: "bubble",
      }),
    ).toBe(false);
  });
});

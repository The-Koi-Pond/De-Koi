import { describe, expect, it } from "vitest";

import {
  resolveConversationRegenerationDisplay,
  shouldRenderBubbleRegenerationDraft,
  shouldRenderConversationLiveStreamMessage,
  shouldRenderConversationRegenerationStream,
} from "./conversation-streaming-draft";

describe("conversation streaming draft display", () => {
  it("does not render partial response text as a live conversation message", () => {
    expect(
      shouldRenderConversationLiveStreamMessage({
        allowPartialResponses: false,
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        isRegenerating: false,
        isStreamWindingDown: false,
        messageStyle: "bubble",
        hasStreamBufferContent: true,
      }),
    ).toBe(false);
  });

  it("preserves the live-stream predicate when partial responses are allowed", () => {
    expect(
      shouldRenderConversationLiveStreamMessage({
        allowPartialResponses: true,
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        isRegenerating: false,
        isStreamWindingDown: false,
        messageStyle: "classic",
        hasStreamBufferContent: true,
      }),
    ).toBe(true);
  });

  it("still allows the typing indicator before clean final text is saved", () => {
    expect(
      shouldRenderConversationLiveStreamMessage({
        allowPartialResponses: false,
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        isRegenerating: false,
        isStreamWindingDown: false,
        messageStyle: "bubble",
        hasStreamBufferContent: false,
      }),
    ).toBe(false);
  });

  it("does not replace an existing conversation message with partial regeneration text", () => {
    expect(
      shouldRenderConversationRegenerationStream({
        allowPartialResponses: false,
        isRegenerating: true,
        isBubbleRegenerating: false,
        hasStreamBufferContent: true,
      }),
    ).toBe(false);
  });

  it("keeps active regeneration feedback without rendering partial replacement text", () => {
    expect(
      resolveConversationRegenerationDisplay({
        allowPartialResponses: false,
        isRegenerating: true,
        savedMessageContent: "Saved response.",
        savedContentParts: ["Saved response."],
        partialMessageContent: "Partial replacement.",
        partialContentParts: ["Partial replacement."],
      }),
    ).toEqual({
      messageContent: "",
      contentParts: undefined,
      showActiveRegeneration: true,
    });
  });

  it("preserves regeneration partial text when the caller policy allows it", () => {
    expect(
      resolveConversationRegenerationDisplay({
        allowPartialResponses: true,
        isRegenerating: true,
        savedMessageContent: "Saved response.",
        savedContentParts: ["Saved response."],
        partialMessageContent: "Partial replacement.",
        partialContentParts: ["Partial replacement."],
      }),
    ).toEqual({
      messageContent: "Partial replacement.",
      contentParts: ["Partial replacement."],
      showActiveRegeneration: true,
    });
  });

  it("leaves completed conversation text alone when no regeneration is active", () => {
    expect(
      resolveConversationRegenerationDisplay({
        allowPartialResponses: false,
        isRegenerating: false,
        savedMessageContent: "Saved response.",
        savedContentParts: ["Saved response."],
        partialMessageContent: "Partial replacement.",
        partialContentParts: ["Partial replacement."],
      }),
    ).toEqual({
      messageContent: "Saved response.",
      contentParts: ["Saved response."],
      showActiveRegeneration: false,
    });
  });

  it("preserves classic regeneration streaming when partial responses are allowed", () => {
    expect(
      shouldRenderConversationRegenerationStream({
        allowPartialResponses: true,
        isRegenerating: true,
        isBubbleRegenerating: false,
        hasStreamBufferContent: true,
      }),
    ).toBe(true);
  });

  it("does not render partial regeneration text in conversation bubbles", () => {
    expect(
      shouldRenderBubbleRegenerationDraft({
        allowPartialResponses: false,
        isBubbleRegenerating: true,
        backingMessageChanged: false,
      }),
    ).toBe(false);
  });

  it("preserves bubble regeneration drafts when partial responses are allowed", () => {
    expect(
      shouldRenderBubbleRegenerationDraft({
        allowPartialResponses: true,
        isBubbleRegenerating: true,
        backingMessageChanged: false,
      }),
    ).toBe(true);
  });
});

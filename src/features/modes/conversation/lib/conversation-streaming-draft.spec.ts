import { describe, expect, it } from "vitest";

import {
  shouldRenderBubbleRegenerationDraft,
  shouldRenderConversationLiveStreamMessage,
  shouldRenderConversationRegenerationStream,
} from "./conversation-streaming-draft";

describe("conversation streaming draft display", () => {
  it("does not render partial response text as a live conversation message", () => {
    expect(
      shouldRenderConversationLiveStreamMessage({
        isStreaming: true,
        hasDelayedCharacterInfo: false,
        isRegenerating: false,
        isStreamWindingDown: false,
        messageStyle: "bubble",
        hasStreamBufferContent: true,
      }),
    ).toBe(false);
  });

  it("still allows the typing indicator before clean final text is saved", () => {
    expect(
      shouldRenderConversationLiveStreamMessage({
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
        isRegenerating: true,
        isBubbleRegenerating: false,
        hasStreamBufferContent: true,
      }),
    ).toBe(false);
  });

  it("does not render partial regeneration text in conversation bubbles", () => {
    expect(
      shouldRenderBubbleRegenerationDraft({
        isBubbleRegenerating: true,
        backingMessageChanged: false,
      }),
    ).toBe(false);
  });
});
import { describe, expect, it } from "vitest";
import {
  EMPTY_STREAMING_BUBBLE_DRAFT,
  bubbleRegenerationBackingSignature,
  hasBubbleRegenerationBackingChanged,
  shouldRenderBubbleRegenerationDraft,
  updateStreamingBubbleDraft,
} from "./conversation-streaming-draft";

describe("conversation streaming bubble draft", () => {
  it("keeps a regeneration preview through buffer wind-down until the backing message updates", () => {
    const originalSignature = bubbleRegenerationBackingSignature({
      id: "message-1",
      content: "Original response.",
      activeSwipeIndex: 0,
      swipeCount: 1,
    });
    const replacementSignature = bubbleRegenerationBackingSignature({
      id: "message-1",
      content: "Replacement response.",
      activeSwipeIndex: 1,
      swipeCount: 2,
    });

    const withPreview = updateStreamingBubbleDraft(EMPTY_STREAMING_BUBBLE_DRAFT, {
      key: "chat-1:message-1:char-1",
      preview: "Replacement response.",
      streamBuffer: "Replacement response.",
      backingSignature: originalSignature,
    });
    const afterBufferClear = updateStreamingBubbleDraft(withPreview, {
      key: "chat-1:message-1:char-1",
      preview: "",
      streamBuffer: "",
      backingSignature: originalSignature,
    });

    expect(afterBufferClear.text).toBe("Replacement response.");
    expect(
      shouldRenderBubbleRegenerationDraft({
        isBubbleRegenerating: true,
        backingMessageChanged: hasBubbleRegenerationBackingChanged(afterBufferClear, originalSignature),
      }),
    ).toBe(true);
    expect(
      shouldRenderBubbleRegenerationDraft({
        isBubbleRegenerating: true,
        backingMessageChanged: hasBubbleRegenerationBackingChanged(afterBufferClear, replacementSignature),
      }),
    ).toBe(false);
  });

  it("accepts shorter replacement stream text instead of only growing the preview", () => {
    const original = updateStreamingBubbleDraft(EMPTY_STREAMING_BUBBLE_DRAFT, {
      key: "chat-1:new:char-1",
      preview: "Longer streamed response.",
      streamBuffer: "Longer streamed response.",
      backingSignature: "",
    });

    const replaced = updateStreamingBubbleDraft(original, {
      key: "chat-1:new:char-1",
      preview: "Short.",
      streamBuffer: "Short.",
      backingSignature: "",
    });

    expect(replaced.text).toBe("Short.");
    expect(replaced.source).toBe("Short.");
  });
});

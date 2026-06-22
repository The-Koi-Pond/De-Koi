interface BubbleDraftMessageSignatureInput {
  id: string;
  content: string;
  activeSwipeIndex: number;
  swipeCount?: number;
}

export interface StreamingBubbleDraftState {
  key: string;
  text: string;
  source: string;
  backingSignature: string;
}

export const EMPTY_STREAMING_BUBBLE_DRAFT: StreamingBubbleDraftState = {
  key: "",
  text: "",
  source: "",
  backingSignature: "",
};

export function bubbleRegenerationBackingSignature(message: BubbleDraftMessageSignatureInput | null | undefined) {
  if (!message) return "";
  return [message.id, message.content, message.activeSwipeIndex, message.swipeCount ?? 0].join("\u0000");
}

export function updateStreamingBubbleDraft(
  current: StreamingBubbleDraftState,
  input: {
    key: string | null;
    preview: string;
    streamBuffer: string;
    backingSignature: string;
  },
): StreamingBubbleDraftState {
  if (!input.key) {
    return current.key || current.text || current.source || current.backingSignature
      ? EMPTY_STREAMING_BUBBLE_DRAFT
      : current;
  }

  if (current.key !== input.key) {
    return {
      key: input.key,
      text: input.preview,
      source: input.streamBuffer,
      backingSignature: input.backingSignature,
    };
  }

  if (!input.streamBuffer && current.source) return current;

  const sourceWasReplaced = !!current.source && !input.streamBuffer.startsWith(current.source);
  if (sourceWasReplaced || input.preview.length > current.text.length) {
    return { ...current, text: input.preview, source: input.streamBuffer };
  }

  if (current.source !== input.streamBuffer) return { ...current, source: input.streamBuffer };
  return current;
}

export function hasBubbleRegenerationBackingChanged(draft: StreamingBubbleDraftState, currentBackingSignature: string) {
  return !!draft.backingSignature && !!currentBackingSignature && draft.backingSignature !== currentBackingSignature;
}

export function shouldRenderBubbleRegenerationDraft(input: {
  allowPartialResponses: boolean;
  isBubbleRegenerating: boolean;
  backingMessageChanged: boolean;
}) {
  return input.allowPartialResponses && input.isBubbleRegenerating && !input.backingMessageChanged;
}

export function shouldRenderConversationLiveStreamMessage(input: {
  allowPartialResponses: boolean;
  isStreaming: boolean;
  hasDelayedCharacterInfo: boolean;
  isRegenerating: boolean;
  isStreamWindingDown: boolean;
  messageStyle: string;
  hasStreamBufferContent: boolean;
}) {
  if (!input.allowPartialResponses) return false;
  return (
    input.isStreaming &&
    !input.hasDelayedCharacterInfo &&
    !input.isRegenerating &&
    !input.isStreamWindingDown &&
    (input.messageStyle === "bubble" || input.hasStreamBufferContent)
  );
}

export function shouldRenderConversationRegenerationStream(input: {
  allowPartialResponses: boolean;
  isRegenerating: boolean;
  isBubbleRegenerating: boolean;
  hasStreamBufferContent: boolean;
}) {
  return (
    input.allowPartialResponses && input.isRegenerating && !input.isBubbleRegenerating && input.hasStreamBufferContent
  );
}

export function resolveConversationRegenerationDisplay<TContentParts>(input: {
  isRegenerating: boolean;
  messageContent: string;
  contentParts: TContentParts | undefined;
}) {
  if (!input.isRegenerating) {
    return {
      messageContent: input.messageContent,
      contentParts: input.contentParts,
      showActiveRegeneration: false,
    };
  }

  return {
    messageContent: "",
    contentParts: undefined,
    showActiveRegeneration: true,
  };
}

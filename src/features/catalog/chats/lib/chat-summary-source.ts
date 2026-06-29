import type { ChatSummaryEntrySource, Message } from "../../../../engine/contracts/types/chat";

export type ChatSummarySourceMode = Extract<ChatSummaryEntrySource, "all" | "last" | "range">;

export type ChatSummarySourceSelectionInput = {
  sourceMode?: ChatSummarySourceMode;
  limit: number;
  rangeStartIndex?: number;
  rangeEndIndex?: number;
};

export type ChatSummarySourceSelection = {
  messages: Message[];
  sourceMode: ChatSummarySourceMode;
  rangeStartIndex?: number;
  rangeEndIndex?: number;
};

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function messageHiddenFromAi(message: Message) {
  const extra = parseRecord(message.extra);
  return extra.hiddenFromAI === true || extra.hiddenFromAi === true;
}

function chronologicalMessages(messages: Message[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const createdAt = left.message.createdAt.localeCompare(right.message.createdAt);
      if (createdAt !== 0) return createdAt;
      const id = left.message.id.localeCompare(right.message.id);
      return id !== 0 ? id : left.index - right.index;
    })
    .map((row) => row.message);
}

export function selectChatSummarySourceMessages(
  messages: Message[],
  input: ChatSummarySourceSelectionInput,
): ChatSummarySourceSelection {
  const orderedMessages = chronologicalMessages(messages);
  const hasRange = Number.isInteger(input.rangeStartIndex) && Number.isInteger(input.rangeEndIndex);
  const sourceMode = input.sourceMode ?? (hasRange ? "range" : "last");
  const rangeLow =
    sourceMode === "range" ? Math.max(1, Math.min(input.rangeStartIndex!, input.rangeEndIndex!)) : undefined;
  const rangeHigh = sourceMode === "range" ? Math.max(input.rangeStartIndex!, input.rangeEndIndex!) : undefined;
  if (sourceMode === "range") {
    if (!rangeLow || !rangeHigh || rangeHigh > orderedMessages.length) {
      throw new Error("Summary range is outside this chat's message history.");
    }
    if (rangeHigh - rangeLow + 1 > 200) {
      throw new Error("Summary ranges cannot include more than 200 messages.");
    }
  }

  const sourceMessages =
    sourceMode === "all"
      ? orderedMessages
      : sourceMode === "range"
        ? orderedMessages.slice(rangeLow! - 1, rangeHigh)
        : orderedMessages.slice(-input.limit);
  return {
    messages: sourceMessages.filter((message) => !messageHiddenFromAi(message) && !!message.content?.trim()),
    sourceMode,
    rangeStartIndex: rangeLow,
    rangeEndIndex: rangeHigh,
  };
}

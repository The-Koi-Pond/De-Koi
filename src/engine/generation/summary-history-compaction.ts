import type { ChatMLMessage } from "../contracts/types/prompt";

export interface CoveredSummaryHistorySelection {
  messages: ChatMLMessage[];
  sourceMessages: Record<string, unknown>[];
  compactedCount: number;
  coversPriorHistory: boolean;
}

/**
 * Remove only the oldest history that enabled summaries explicitly identify.
 * Coverage must begin at the first selected message and remain contiguous.
 */
export function compactHistorySelectionForCoveredSummaries(input: {
  messages: ChatMLMessage[];
  sourceMessages: Record<string, unknown>[];
  coveredMessageIds: string[];
  tailMessages: number;
}): CoveredSummaryHistorySelection {
  const unchanged = {
    messages: input.messages,
    sourceMessages: input.sourceMessages,
    compactedCount: 0,
    coversPriorHistory: false,
  };
  if (input.messages.length !== input.sourceMessages.length || input.messages.length === 0) return unchanged;

  const coveredIds = new Set(input.coveredMessageIds.map((id) => id.trim()).filter(Boolean));
  if (coveredIds.size === 0) return unchanged;

  let coveredPrefixLength = 0;
  for (const sourceMessage of input.sourceMessages) {
    const id = typeof sourceMessage.id === "string" ? sourceMessage.id.trim() : "";
    if (!id || !coveredIds.has(id)) break;
    coveredPrefixLength += 1;
  }
  if (coveredPrefixLength === 0) return unchanged;

  const tailMessages = Math.max(0, Math.floor(input.tailMessages));
  const firstTailIndex = Math.max(0, input.messages.length - tailMessages);
  const compactedCount = Math.min(coveredPrefixLength, firstTailIndex);
  if (compactedCount === 0) {
    return { ...unchanged, coversPriorHistory: true };
  }

  return {
    messages: input.messages.slice(compactedCount),
    sourceMessages: input.sourceMessages.slice(compactedCount),
    compactedCount,
    coversPriorHistory: true,
  };
}

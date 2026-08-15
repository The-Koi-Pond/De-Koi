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

  const orderedCoveredIds = input.coveredMessageIds.map((id) => id.trim()).filter(Boolean);
  const coveredIds = new Set(orderedCoveredIds);
  if (coveredIds.size === 0) return unchanged;
  if (coveredIds.size !== orderedCoveredIds.length) return unchanged;
  const coveredOrder = new Map(orderedCoveredIds.map((id, index) => [id, index]));

  const sourceMessageIds = input.sourceMessages.map((sourceMessage) =>
    typeof sourceMessage.id === "string" ? sourceMessage.id.trim() : "",
  );
  const firstUncoveredIndex = sourceMessageIds.findIndex((id) => !id || !coveredIds.has(id));
  const coveredPrefixLength = firstUncoveredIndex < 0 ? sourceMessageIds.length : firstUncoveredIndex;
  const hasCoverageAfterGap =
    firstUncoveredIndex >= 0 &&
    sourceMessageIds.slice(firstUncoveredIndex + 1).some((id) => id && coveredIds.has(id));
  if (hasCoverageAfterGap) return unchanged;
  if (coveredPrefixLength === 0) return unchanged;
  let priorCoverageIndex = -1;
  for (const id of sourceMessageIds.slice(0, coveredPrefixLength)) {
    const coverageIndex = coveredOrder.get(id);
    if (coverageIndex === undefined || coverageIndex <= priorCoverageIndex) return unchanged;
    priorCoverageIndex = coverageIndex;
  }

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

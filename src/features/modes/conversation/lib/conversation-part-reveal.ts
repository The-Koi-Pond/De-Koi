import type { Message } from "../../../../engine/contracts/types/chat";

export const CONVERSATION_PART_REVEAL_FRESHNESS_MS = 15_000;

interface ConversationPartRevealCandidate {
  key: string;
  role: Message["role"];
  createdAtMs: number;
  partCount: number;
}

interface CollectFreshAssistantPartRevealStartsOptions {
  initialLoadSettled: boolean;
  candidates: ConversationPartRevealCandidate[];
  prevKeys: ReadonlySet<string>;
  seenKeys: ReadonlySet<string>;
  now: number;
  freshnessMs?: number;
}

export interface ConversationPartRevealStart {
  key: string;
  count: number;
}

export type ConversationRevealGenerationMap = Record<string, number>;

export function collectFreshAssistantPartRevealStarts({
  initialLoadSettled,
  candidates,
  prevKeys,
  seenKeys,
  now,
  freshnessMs = CONVERSATION_PART_REVEAL_FRESHNESS_MS,
}: CollectFreshAssistantPartRevealStartsOptions): ConversationPartRevealStart[] {
  if (!initialLoadSettled) return [];

  const starts: ConversationPartRevealStart[] = [];
  for (const candidate of candidates) {
    if (candidate.role !== "assistant") continue;
    if (candidate.partCount <= 1) continue;
    if (prevKeys.has(candidate.key) || seenKeys.has(candidate.key)) continue;
    if (!Number.isFinite(candidate.createdAtMs)) continue;
    if (now - candidate.createdAtMs >= freshnessMs) continue;
    starts.push({ key: candidate.key, count: candidate.partCount });
  }
  return starts;
}

interface ResolveConversationVisiblePartCountOptions {
  key: string;
  partCount: number;
  currentVisiblePartCount?: number;
  freshRevealStarts: ConversationPartRevealStart[];
}

export function resolveConversationVisiblePartCount({
  key,
  partCount,
  currentVisiblePartCount,
  freshRevealStarts,
}: ResolveConversationVisiblePartCountOptions): number {
  if (currentVisiblePartCount != null) return Math.max(1, Math.min(currentVisiblePartCount, partCount));
  return freshRevealStarts.some((start) => start.key === key) ? 1 : partCount;
}

export function startConversationRevealGeneration(
  generations: ConversationRevealGenerationMap,
  key: string,
): number {
  const nextGeneration = (generations[key] ?? 0) + 1;
  generations[key] = nextGeneration;
  return nextGeneration;
}

export function isCurrentConversationRevealGeneration(
  generations: ConversationRevealGenerationMap,
  key: string,
  generation: number,
): boolean {
  return generations[key] === generation;
}

export function clearConversationRevealGeneration(
  generations: ConversationRevealGenerationMap,
  key: string,
  generation?: number,
) {
  if (generation == null || generations[key] === generation) {
    delete generations[key];
  }
}

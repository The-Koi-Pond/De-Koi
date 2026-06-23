import type {
  GenerationContextAttribution,
  GenerationContextAttributionItem,
  GenerationContextAttributionKind,
} from "../contracts/types/chat";

const ATTRIBUTION_SNIPPET_MAX_CHARS = 240;
const HIDDEN_AGENT_TYPES = new Set(["secret_plot", "secret-plot", "secret-plot-driver", "secret_plot_driver"]);

interface LorebookAttributionEntry {
  id: string;
  lorebookId: string;
  name: string;
  content: string;
  tag: string;
  matchedKeys: string[];
  order: number;
  constant: boolean;
}

export interface MemoryRecallAttributionInput {
  packedLines: string[];
  recalled: Array<{ content: string; similarity: number; lexicalScore: number }>;
  consideredCount: number;
}

export interface MemoryRecallAttributionResult {
  promptLines: string[];
  items: GenerationContextAttributionItem[];
}

export interface ChatHistoryAttributionInput {
  included: ReadonlyArray<{
    role: "system" | "user" | "assistant";
    content: string;
    characterId?: string | null;
    name?: string | null;
  }>;
  hiddenFromAiCount?: number;
  skippedByLimitCount?: number;
  requestedLimit?: number;
}

function snippetForText(text: string, maxChars = ATTRIBUTION_SNIPPET_MAX_CHARS): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function titleCaseAgentType(agentType: string): string {
  return agentType
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function attributionKindForAgent(agentType: string): GenerationContextAttributionKind {
  if (agentType === "knowledge-retrieval" || agentType === "knowledge_retrieval") return "knowledge_retrieval";
  if (agentType === "knowledge-router" || agentType === "knowledge_router") return "knowledge_router";
  return "agent_injection";
}

function isHiddenAgentType(agentType: string): boolean {
  return HIDDEN_AGENT_TYPES.has(agentType.trim().toLowerCase());
}

function positiveCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function roleLabel(role: "system" | "user" | "assistant"): string {
  if (role === "assistant") return "Assistant message";
  if (role === "system") return "System message";
  return "User message";
}

export function attributionForChatSummary(summary: string | null | undefined): GenerationContextAttributionItem[] {
  const snippet = snippetForText(summary ?? "");
  if (!snippet) return [];
  return [
    {
      kind: "chat_summary",
      label: "Chat Summary",
      status: "injected",
      snippet,
    },
  ];
}

export function attributionForChatHistory(input: ChatHistoryAttributionInput): GenerationContextAttributionItem[] {
  const requestedLimit = positiveCount(input.requestedLimit);
  const items: GenerationContextAttributionItem[] = input.included.map((message, index) => ({
    kind: "chat_history",
    label: message.name?.trim() || roleLabel(message.role),
    status: "injected",
    sourceId: message.characterId?.trim() || null,
    snippet: snippetForText(message.content),
    metadata: {
      role: message.role,
      rank: index + 1,
      ...(requestedLimit ? { requestedLimit } : {}),
    },
  }));

  const hiddenFromAiCount = positiveCount(input.hiddenFromAiCount);
  if (hiddenFromAiCount) {
    items.push({
      kind: "chat_history",
      label: `${hiddenFromAiCount} hidden from AI`,
      status: "skipped",
      snippet: null,
      metadata: { reason: "hidden_from_ai", count: hiddenFromAiCount },
    });
  }

  const skippedByLimitCount = positiveCount(input.skippedByLimitCount);
  if (skippedByLimitCount) {
    items.push({
      kind: "chat_history",
      label: `${skippedByLimitCount} skipped by history limit`,
      status: "skipped",
      snippet: null,
      metadata: {
        reason: "history_limit",
        count: skippedByLimitCount,
        ...(requestedLimit ? { requestedLimit } : {}),
      },
    });
  }

  return items;
}

export function attributionForMemoryRecall(input: MemoryRecallAttributionInput): MemoryRecallAttributionResult {
  const items = input.packedLines.map((line, index) => {
    const recalled = input.recalled[index];
    return {
      kind: "memory_recall",
      label: `Memory ${index + 1}`,
      status: "injected",
      snippet: snippetForText(line),
      metadata: {
        rank: index + 1,
        consideredCount: input.consideredCount,
        ...(recalled ? { similarity: recalled.similarity, lexicalScore: recalled.lexicalScore } : {}),
      },
    } satisfies GenerationContextAttributionItem;
  });

  return { promptLines: [...input.packedLines], items };
}

export function attributionForLorebookEntries(
  entries: readonly LorebookAttributionEntry[],
): GenerationContextAttributionItem[] {
  return entries.map((entry) => ({
    kind: "lorebook",
    label: entry.name.trim() || "Lorebook entry",
    status: "injected",
    sourceId: entry.id,
    sourceCollection: "lorebook_entries",
    parentSourceId: entry.lorebookId,
    snippet: snippetForText(entry.content),
    metadata: {
      tag: entry.tag,
      matchedKeys: entry.matchedKeys,
      order: entry.order,
      constant: entry.constant,
    },
  }));
}

export function attributionForAgentInjections(
  injections: ReadonlyArray<{ agentType: string; agentName?: string; text: string }>,
): GenerationContextAttributionItem[] {
  return injections
    .filter((injection) => injection.text.trim())
    .map((injection) => {
      const agentType = injection.agentType.trim();
      const redacted = isHiddenAgentType(agentType);
      return {
        kind: attributionKindForAgent(agentType),
        label: injection.agentName?.trim() || titleCaseAgentType(agentType) || "Agent injection",
        status: redacted ? "redacted" : "injected",
        snippet: redacted ? null : snippetForText(injection.text),
        metadata: {
          agentType,
          redacted,
        },
      } satisfies GenerationContextAttributionItem;
    });
}

export function generationContextAttribution(groups: readonly unknown[]): GenerationContextAttribution | null {
  const items = groups
    .flatMap((group) => (Array.isArray(group) ? group : [group]))
    .filter((item): item is GenerationContextAttributionItem => {
      return !!item && typeof item === "object" && !Array.isArray(item);
    });

  return items.length > 0 ? { source: "saved_snapshot", items } : null;
}

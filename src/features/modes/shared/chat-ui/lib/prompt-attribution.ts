import type {
  GenerationContextAttribution,
  GenerationContextAttributionItem,
  GenerationContextAttributionKind,
  GenerationContextAttributionStatus,
} from "../../../../../engine/contracts/types/chat";

type PromptAttributionSourceTone = "exact" | "best_effort";

interface PromptAttributionViewItem {
  label: string;
  statusLabel: string;
  snippet: string | null;
  metadata: Record<string, unknown> | null;
}

interface PromptAttributionViewGroup {
  label: string;
  items: PromptAttributionViewItem[];
}

export interface PromptAttributionViewModel {
  sourceLabel: string;
  sourceTone: PromptAttributionSourceTone;
  groups: PromptAttributionViewGroup[];
}

const GROUP_LABELS: Record<GenerationContextAttributionKind, string> = {
  chat_history: "Recent Chat",
  chat_summary: "Chat Summary",
  memory_recall: "Memory",
  lorebook: "Lorebook",
  knowledge_retrieval: "Knowledge Retrieval",
  knowledge_router: "Knowledge Router",
  agent_injection: "Agent Injections",
};

function statusLabel(status: GenerationContextAttributionStatus): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function shouldRedactSnippet(item: GenerationContextAttributionItem): boolean {
  return item.status === "redacted" || item.metadata?.redacted === true;
}

function viewItem(item: GenerationContextAttributionItem): PromptAttributionViewItem {
  return {
    label: item.label,
    statusLabel: statusLabel(item.status),
    snippet: shouldRedactSnippet(item) ? null : item.snippet?.trim() || null,
    metadata: item.metadata ?? null,
  };
}

export function buildPromptAttributionViewModel(
  attribution: GenerationContextAttribution | null | undefined,
): PromptAttributionViewModel | null {
  if (!attribution?.items?.length) return null;

  const groups = new Map<string, PromptAttributionViewItem[]>();
  for (const item of attribution.items) {
    const label = GROUP_LABELS[item.kind] ?? "Context";
    const items = groups.get(label) ?? [];
    items.push(viewItem(item));
    groups.set(label, items);
  }

  return {
    sourceLabel: attribution.source === "saved_snapshot" ? "Saved attribution" : "Best-effort attribution",
    sourceTone: attribution.source === "saved_snapshot" ? "exact" : "best_effort",
    groups: Array.from(groups.entries()).map(([label, items]) => ({ label, items })),
  };
}

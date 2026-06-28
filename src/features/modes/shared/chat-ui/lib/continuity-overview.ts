import { BUILT_IN_AGENTS } from "../../../../../engine/contracts/types/agent";
import type { ChatMetadata, ChatMode } from "../../../../../engine/contracts/types/chat";

export type ContinuityOverviewAction =
  | "open_memories"
  | "open_summaries"
  | "manage_lorebooks"
  | "manage_agents"
  | "inspect_prompt";

type ContinuityOverviewStatus = "active" | "idle" | "warning";

export interface ContinuityOverviewSection {
  id: "memory" | "summary" | "lorebooks" | "trackers";
  label: string;
  status: ContinuityOverviewStatus;
  value: string;
  detail: string;
  action: ContinuityOverviewAction;
}

export interface ContinuityOverviewViewModel {
  headline: string;
  sections: ContinuityOverviewSection[];
}

interface ContinuityOverviewInput {
  chatMode: ChatMode;
  metadata: Partial<ChatMetadata>;
  activeLorebookCount: number;
  totalMessageCount?: number | null;
}

const TRACKER_AGENT_NAMES = new Map(
  BUILT_IN_AGENTS.filter((agent) => agent.category === "tracker").map((agent) => [agent.id, agent.name]),
);

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function enabledSummaryEntryCount(metadata: Partial<ChatMetadata>): number {
  const entries = Array.isArray(metadata.summaryEntries) ? metadata.summaryEntries : [];
  const count = entries.filter((entry) => entry.enabled !== false && entry.content.trim().length > 0).length;
  if (count > 0) return count;
  return typeof metadata.summary === "string" && metadata.summary.trim().length > 0 ? 1 : 0;
}

function memoryRecallEnabled(chatMode: ChatMode, metadata: Partial<ChatMetadata>): boolean {
  if (typeof metadata.enableMemoryRecall === "boolean") return metadata.enableMemoryRecall;
  if (chatMode === "conversation") return true;
  return metadata.sceneStatus === "active";
}

function readBehindMessages(metadata: Partial<ChatMetadata>): number {
  const value = metadata.memoryRecallReadBehindMessages;
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function activeTrackerAgentNames(activeAgentIds: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (activeAgentIds ?? [])
        .map((id) => TRACKER_AGENT_NAMES.get(id))
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0),
    ),
  );
}

function trackerDetail(names: string[], chatMode: ChatMode): string {
  if (chatMode === "conversation") {
    if (names.length === 0) return "No Conversation automation agents are active for this chat.";
    if (names.length <= 3) return `${names.join(" and ")} can update Conversation automation after messages.`;
    return `${names.length} automation agents can update Conversation automation after messages.`;
  }
  if (names.length === 0) return "No tracker or world-state agents are active for this chat.";
  if (names.length <= 3) return `${names.join(" and ")} can update continuity after messages.`;
  return `${names.length} tracker agents can update continuity after messages.`;
}

export function buildContinuityOverviewViewModel(input: ContinuityOverviewInput): ContinuityOverviewViewModel {
  const summaryCount = enabledSummaryEntryCount(input.metadata);
  const memoryEnabled = memoryRecallEnabled(input.chatMode, input.metadata);
  const trackerNames = activeTrackerAgentNames(input.metadata.activeAgentIds);
  const automaticSummaryEnabled = input.metadata.activeAgentIds?.includes("chat-summary") === true;
  const activeLorebookCount = Math.max(0, Math.trunc(input.activeLorebookCount));

  const sections: ContinuityOverviewSection[] = [
    {
      id: "memory",
      label: "Memory",
      status: memoryEnabled ? "active" : "idle",
      value: memoryEnabled ? "On" : "Off",
      detail: memoryEnabled
        ? `Earlier chat fragments can be recalled after ${pluralize(readBehindMessages(input.metadata), "recent message")}.`
        : "Memory Recall is not injecting earlier chat fragments.",
      action: "open_memories",
    },
    {
      id: "summary",
      label: "Summary",
      status: summaryCount > 0 ? "active" : "idle",
      value: summaryCount > 0 ? pluralize(summaryCount, "entry", "entries") : "Missing",
      detail:
        summaryCount > 0
          ? automaticSummaryEnabled
            ? "Automated Chat Summary is also enabled."
            : "A saved chat summary can be included in future prompts."
          : automaticSummaryEnabled
            ? "Automated Chat Summary is enabled but has not written a summary yet."
            : "No saved chat summary is available yet.",
      action: "open_summaries",
    },
    {
      id: "lorebooks",
      label: "World Info",
      status: activeLorebookCount > 0 ? "active" : "idle",
      value: activeLorebookCount > 0 ? pluralize(activeLorebookCount, "source") : "None",
      detail:
        activeLorebookCount > 0
          ? "Active lorebooks can inject matching world info into prompts."
          : "No lorebook or scoped world-info source is active for this chat.",
      action: "manage_lorebooks",
    },
    {
      id: "trackers",
      label: input.chatMode === "conversation" ? "Automation" : "Trackers",
      status: trackerNames.length > 0 ? "active" : "idle",
      value: trackerNames.length > 0 ? pluralize(trackerNames.length, "agent") : "None",
      detail: trackerDetail(trackerNames, input.chatMode),
      action: "manage_agents",
    },
  ];

  const activeCount = sections.filter((section) => section.status === "active").length;
  return {
    headline: activeCount > 0 ? `${pluralize(activeCount, "continuity source")} active` : "No continuity sources active yet",
    sections,
  };
}

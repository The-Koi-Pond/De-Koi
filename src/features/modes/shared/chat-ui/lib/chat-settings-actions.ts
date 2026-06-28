import type { Chat, ChatMode } from "../../../../../engine/contracts/types/chat";
import { enabledChatAgentIds } from "../../../../../engine/contracts/types/agent";

export type ChatSettingsMetadataPatch = Record<string, unknown>;

export type ModePromptField = "narratorStyleInstructions" | "gameExtraPrompt" | "sceneSystemPrompt";

export function buildModePromptMetadataPatch({
  field,
  draft,
  stored,
}: {
  field: ModePromptField;
  draft: string;
  stored: string;
}): ChatSettingsMetadataPatch | null {
  if (field === "narratorStyleInstructions") {
    const next = draft.trim();
    return next !== stored ? { [field]: next || null } : null;
  }

  if (draft === stored) return null;
  return { [field]: field === "gameExtraPrompt" ? draft || null : draft };
}

export function chatActiveAgentIds(chat: Chat): string[] {
  const metadata =
    chat.metadata && typeof chat.metadata === "object" && !Array.isArray(chat.metadata) ? chat.metadata : {};
  return enabledChatAgentIds(metadata, chat.mode as ChatMode);
}

export function hasSecretPlotMemory(memory: Record<string, unknown> | null | undefined): boolean {
  if (!memory) return false;
  const arc = memory.overarchingArc;
  if (typeof arc === "string" && arc.trim()) return true;
  if (arc && typeof arc === "object") {
    const arcRecord = arc as Record<string, unknown>;
    if (
      String(arcRecord.description ?? "").trim() ||
      String(arcRecord.protagonistArc ?? "").trim() ||
      arcRecord.completed === true
    ) {
      return true;
    }
  }

  const sceneDirections = memory.sceneDirections;
  if (
    Array.isArray(sceneDirections) &&
    sceneDirections.some((entry) =>
      typeof entry === "string"
        ? entry.trim()
        : !!(entry && typeof entry === "object" && String((entry as Record<string, unknown>).direction ?? "").trim()),
    )
  ) {
    return true;
  }

  const pacing = memory.pacing;
  if (typeof pacing === "string" ? pacing.trim() : pacing != null) return true;
  const recentlyFulfilled = memory.recentlyFulfilled;
  return Array.isArray(recentlyFulfilled) && recentlyFulfilled.some((entry) => String(entry ?? "").trim());
}

type UpdateMetadataMutation = {
  mutateAsync: (
    patch: ChatSettingsMetadataPatch & { id: string },
    options?: { onSuccess?: () => void | Promise<void> },
  ) => Promise<unknown>;
};

type RefreshStatusMessages = (chatId: string) => Promise<{ refreshed: string[]; skipped: string[] }>;

type StatusMessagesToggleOptions = {
  chat: Pick<Chat, "id">;
  enabled: boolean;
  nextEnabled?: boolean;
  rollbackEnabled?: boolean;
  updateMeta: UpdateMetadataMutation;
  refreshStatusMessages: RefreshStatusMessages;
  invalidateCharacters: () => void | Promise<void>;
  invalidateChat: () => void | Promise<void>;
  showRefreshFailure: (message: string) => void | Promise<void>;
};

export async function toggleConversationStatusMessages({
  chat,
  enabled,
  nextEnabled,
  rollbackEnabled = false,
  updateMeta,
  refreshStatusMessages,
  invalidateCharacters,
  invalidateChat,
  showRefreshFailure,
}: StatusMessagesToggleOptions): Promise<void> {
  const targetEnabled = nextEnabled ?? !enabled;
  await updateMeta.mutateAsync({ id: chat.id, conversationStatusMessagesEnabled: targetEnabled });
  if (!targetEnabled) return;

  try {
    const result = await refreshStatusMessages(chat.id);
    if (result.refreshed.length > 0) {
      await invalidateCharacters();
      await invalidateChat();
    }
  } catch (error) {
    await updateMeta
      .mutateAsync({ id: chat.id, conversationStatusMessagesEnabled: rollbackEnabled })
      .catch(() => undefined);
    await invalidateChat();
    await showRefreshFailure(error instanceof Error ? error.message : "Status blurb generation failed.");
  }
}
type AgentMemoryApi = {
  getMemory: (agentId: string, chatId: string) => Promise<{ memory?: Record<string, unknown> | null }>;
  clearMemory: (agentId: string, chatId: string) => Promise<unknown>;
};

export async function toggleChatAgent({
  agentId,
  chat,
  activeAgentIds,
  readLatestChat,
  updateMeta,
  agentMemory,
  confirmSecretPlotRemoval,
  showMutationFailure,
}: {
  agentId: string;
  chat: Chat;
  activeAgentIds: string[];
  readLatestChat: () => Chat | undefined;
  updateMeta: UpdateMetadataMutation;
  agentMemory: AgentMemoryApi;
  confirmSecretPlotRemoval: (message: string) => Promise<boolean>;
  showMutationFailure: (options: { removing: boolean; message: string }) => Promise<void>;
}): Promise<void> {
  const readLatestActiveAgentIds = () => {
    const latestChat = readLatestChat();
    return latestChat ? chatActiveAgentIds(latestChat) : [...activeAgentIds];
  };
  const wasRemoving = readLatestActiveAgentIds().includes(agentId);
  if (wasRemoving && agentId === "secret-plot-driver") {
    let shouldWarn: boolean;
    try {
      const res = await agentMemory.getMemory(agentId, chat.id);
      shouldWarn = hasSecretPlotMemory(res.memory);
    } catch {
      shouldWarn = true;
    }
    if (shouldWarn) {
      const ok = await confirmSecretPlotRemoval(
        "Remove Secret Plot Driver from this chat? This will wipe its hidden plot memory for this chat, including the current arc and scene directions. This cannot be undone.",
      );
      if (!ok) return;
    }
  }

  const current = readLatestActiveAgentIds();
  const isRemoving = wasRemoving;
  const nextAgentIds = isRemoving ? current.filter((id) => id !== agentId) : Array.from(new Set([...current, agentId]));
  let metadataSaved = false;
  try {
    await updateMeta.mutateAsync(
      { id: chat.id, activeAgentIds: nextAgentIds },
      {
        onSuccess: async () => {
          metadataSaved = true;
          if (isRemoving && agentId === "secret-plot-driver") {
            await agentMemory.clearMemory(agentId, chat.id);
          }
        },
      },
    );
  } catch (error) {
    if (metadataSaved && isRemoving && agentId === "secret-plot-driver") {
      const rollbackIds = Array.from(new Set([...readLatestActiveAgentIds(), agentId]));
      await updateMeta.mutateAsync({ id: chat.id, activeAgentIds: rollbackIds }).catch(() => undefined);
    }
    await showMutationFailure({
      removing: isRemoving,
      message: error instanceof Error ? error.message : "The agent list could not be updated. Please try again.",
    });
  }
}

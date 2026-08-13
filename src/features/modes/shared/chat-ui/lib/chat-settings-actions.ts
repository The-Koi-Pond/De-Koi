import type { Chat, ChatMode } from "../../../../../engine/contracts/types/chat";
import { enabledChatAgentIds } from "../../../../../engine/contracts/types/agent";

export type ChatSettingsMetadataPatch = Record<string, unknown>;

export type ModePromptField = "narratorStyleInstructions" | "gameExtraPrompt" | "sceneSystemPrompt";

export function chatToolSelectionMode(metadata: Record<string, unknown>, toolsEnabled: boolean): "explicit" | "all" {
  if (metadata.toolSelectionMode === "all" || metadata.toolSelectionMode === "explicit") {
    return metadata.toolSelectionMode;
  }
  if (
    Array.isArray(metadata.activeToolIds) &&
    metadata.activeToolIds.some((id) => typeof id === "string" && id.trim())
  ) {
    return "explicit";
  }
  return toolsEnabled ? "all" : "explicit";
}

export function chatToolStatusDescription(
  toolsEnabled: boolean,
  selectionMode: "explicit" | "all",
  selectedToolCount: number,
): string {
  if (!toolsEnabled) return "If disabled, no functions will be available.";
  if (selectionMode === "all") return "This chat can use all globally enabled tools.";
  if (selectedToolCount === 0) return "Tool use is enabled, but no functions are selected for this chat.";
  return `This chat can use its ${selectedToolCount} selected function${selectedToolCount === 1 ? "" : "s"}.`;
}

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
export async function toggleChatAgent({
  agentId,
  chat,
  activeAgentIds,
  readLatestChat,
  updateMeta,
  showMutationFailure,
}: {
  agentId: string;
  chat: Chat;
  activeAgentIds: string[];
  readLatestChat: () => Chat | undefined;
  updateMeta: UpdateMetadataMutation;
  showMutationFailure: (options: { removing: boolean; message: string }) => Promise<void>;
}): Promise<void> {
  const readLatestActiveAgentIds = () => {
    const latestChat = readLatestChat();
    return latestChat ? chatActiveAgentIds(latestChat) : [...activeAgentIds];
  };
  const wasRemoving = readLatestActiveAgentIds().includes(agentId);
  const current = readLatestActiveAgentIds();
  const isRemoving = wasRemoving;
  const nextAgentIds = isRemoving ? current.filter((id) => id !== agentId) : Array.from(new Set([...current, agentId]));
  let metadataSaved = false;
  try {
    await updateMeta.mutateAsync(
      { id: chat.id, activeAgentIds: nextAgentIds },
      { onSuccess: () => { metadataSaved = true; } },
    );
  } catch (error) {
    if (metadataSaved && isRemoving) {
      const rollbackIds = Array.from(new Set([...readLatestActiveAgentIds(), agentId]));
      await updateMeta.mutateAsync({ id: chat.id, activeAgentIds: rollbackIds }).catch(() => undefined);
    }
    await showMutationFailure({
      removing: isRemoving,
      message: error instanceof Error ? error.message : "The agent list could not be updated. Please try again.",
    });
  }
}

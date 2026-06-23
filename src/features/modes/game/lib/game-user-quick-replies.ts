import type { QuoteFormat, UserQuickReplyActionConfig } from "../../../../shared/stores/ui.store";
import {
  buildUserQuickReplyMenuEntries,
  type UserQuickReplyMenuEntry,
} from "../../shared/chat-ui";

interface BuildGameUserQuickReplyMenuEntriesContext {
  actions: UserQuickReplyActionConfig[];
  activeChatId: string | null;
  draft: string;
  quoteFormat: QuoteFormat;
  isStreaming: boolean;
  hasPendingGameTurnState: boolean;
  executeGameTurn: (commandLine: string, fallbackError: string) => void | Promise<void>;
}

const PENDING_GAME_TURN_STATE_REASON = "Clear queued dice, movement, or attachments first.";

export function buildGameUserQuickReplyMenuEntries(
  context: BuildGameUserQuickReplyMenuEntriesContext,
): UserQuickReplyMenuEntry[] {
  const entries = buildUserQuickReplyMenuEntries({
    actions: context.actions,
    mode: "game",
    activeChatId: context.activeChatId,
    draft: context.draft,
    quoteFormat: context.quoteFormat,
    isStreaming: context.isStreaming,
    hasPendingAttachments: false,
    executeCommand: context.executeGameTurn,
  });

  if (!context.activeChatId || context.isStreaming || !context.hasPendingGameTurnState) return entries;

  return entries.map((entry) => ({
    ...entry,
    disabled: true,
    disabledReason: PENDING_GAME_TURN_STATE_REASON,
  }));
}
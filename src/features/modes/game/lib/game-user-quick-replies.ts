import type { QuoteFormat, UserQuickReplyActionConfig } from "../../../../shared/stores/ui.store";
import { buildUserQuickReplyMenuEntries, type UserQuickReplyMenuEntry } from "../../shared/chat-ui";

interface BuildGameUserQuickReplyMenuEntriesContext {
  actions: UserQuickReplyActionConfig[];
  activeChatId: string | null;
  draft: string;
  quoteFormat: QuoteFormat;
  isStreaming: boolean;
  hasPendingGameTurnState: boolean;
  executeGameTurn: (commandLine: string, fallbackError: string, consumesDraft: boolean) => void | Promise<void>;
}

const PENDING_GAME_TURN_STATE_REASON = "Clear queued dice, movement, or attachments first.";

export function buildGameUserQuickReplyMenuEntries(
  context: BuildGameUserQuickReplyMenuEntriesContext,
): UserQuickReplyMenuEntry[] {
  const entries = context.actions.flatMap((action) =>
    buildUserQuickReplyMenuEntries({
      actions: [action],
      mode: "game",
      activeChatId: context.activeChatId,
      draft: context.draft,
      quoteFormat: context.quoteFormat,
      isStreaming: context.isStreaming,
      hasPendingAttachments: false,
      executeCommand: (commandLine, fallbackError) =>
        context.executeGameTurn(commandLine, fallbackError, action.includeDraft),
    }),
  );

  if (!context.activeChatId || context.isStreaming || !context.hasPendingGameTurnState) return entries;

  return entries.map((entry) => ({
    ...entry,
    disabled: true,
    disabledReason: PENDING_GAME_TURN_STATE_REASON,
  }));
}

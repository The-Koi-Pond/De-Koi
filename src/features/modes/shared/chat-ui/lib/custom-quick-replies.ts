import type { QuickReplyModeScope, QuoteFormat, UserQuickReplyActionConfig } from "../../../../../shared/stores/ui.store";
import { formatTextQuotes } from "../../../../../shared/lib/dialogue-quotes";
import { matchSlashCommand } from "../../../../../shared/lib/slash-commands";

export interface ResolveUserQuickReplyCommandContext {
  draft: string;
  quoteFormat: QuoteFormat;
}

export interface ResolvedUserQuickReplyCommand {
  commandLine: string;
  invalidReason: string | null;
  requiresDraft: boolean;
}

export interface UserQuickReplyVisibilityContext {
  mode: QuickReplyModeScope;
  activeChatId: string | null;
}

export interface BuildUserQuickReplyMenuEntriesContext extends UserQuickReplyVisibilityContext {
  actions: UserQuickReplyActionConfig[];
  draft: string;
  quoteFormat: QuoteFormat;
  isStreaming: boolean;
  hasPendingAttachments: boolean;
  executeCommand: (commandLine: string, fallbackError: string) => void | Promise<void>;
}

export interface UserQuickReplyMenuEntry {
  id: string;
  label: string;
  description: string;
  iconId: UserQuickReplyActionConfig["iconId"];
  disabled: boolean;
  disabledReason?: string;
  onSelect: () => Promise<void>;
}

const DRAFT_PLACEHOLDER = "{{draft}}";

export function resolveUserQuickReplyCommand(
  action: UserQuickReplyActionConfig,
  context: ResolveUserQuickReplyCommandContext,
): ResolvedUserQuickReplyCommand {
  const template = action.commandTemplate.trim();
  const draft = formatTextQuotes(context.draft.trim(), context.quoteFormat);
  const requiresDraft = action.includeDraft;
  const commandLine = (() => {
    if (!action.includeDraft) return template;
    if (template.includes(DRAFT_PLACEHOLDER)) return template.split(DRAFT_PLACEHOLDER).join(draft).trim();
    return draft ? `${template} ${draft}`.trim() : template;
  })();

  if (!commandLine.startsWith("/")) {
    return { commandLine, invalidReason: "Saved action must start with a slash command.", requiresDraft };
  }

  if (!matchSlashCommand(commandLine)) {
    return { commandLine, invalidReason: "Saved action uses an unknown slash command.", requiresDraft };
  }

  return { commandLine, invalidReason: null, requiresDraft };
}

export function isUserQuickReplyVisible(
  action: UserQuickReplyActionConfig,
  context: UserQuickReplyVisibilityContext,
): boolean {
  if (!action.enabled) return false;
  if (action.scope === "global") return true;
  if (action.scope === "mode") return action.mode === context.mode;
  return !!context.activeChatId && action.chatId === context.activeChatId;
}

function getDisabledReason(
  resolved: ResolvedUserQuickReplyCommand,
  context: Pick<
    BuildUserQuickReplyMenuEntriesContext,
    "activeChatId" | "draft" | "hasPendingAttachments" | "isStreaming"
  >,
): string | undefined {
  if (!context.activeChatId) return "Select or create a chat first.";
  if (context.isStreaming) return "Wait for the current stream to finish.";
  if (context.hasPendingAttachments) return "Clear or post attachments first.";
  if (resolved.invalidReason) return resolved.invalidReason;
  if (resolved.requiresDraft && !context.draft.trim()) return "Type a draft first.";
  return undefined;
}

export function buildUserQuickReplyMenuEntries(
  context: BuildUserQuickReplyMenuEntriesContext,
): UserQuickReplyMenuEntry[] {
  return context.actions
    .filter((action) => isUserQuickReplyVisible(action, context))
    .map((action) => {
      const resolved = resolveUserQuickReplyCommand(action, context);
      const disabledReason = getDisabledReason(resolved, context);
      return {
        id: `user:${action.id}`,
        label: action.label,
        description: resolved.commandLine,
        iconId: action.iconId,
        disabled: !!disabledReason,
        ...(disabledReason ? { disabledReason } : {}),
        onSelect: async () => {
          if (disabledReason) return;
          await context.executeCommand(resolved.commandLine, `${action.label} failed`);
        },
      };
    });
}

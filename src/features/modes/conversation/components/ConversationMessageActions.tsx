import {
  Brain,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Languages,
  Pencil,
  RefreshCw,
  ScrollText,
  Timer,
  Trash2,
} from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { buildSaveMomentSource, IllustrateMomentAction, SaveMomentAction } from "../../shared/chat-ui";
import { MsgAction, type ConversationMessageRenderContext } from "./ConversationMessageShared";

export function ConversationMessageActions({
  context,
  className,
  translationContent,
  showUserThinking = false,
}: {
  context: ConversationMessageRenderContext;
  className: string;
  translationContent: string;
  showUserThinking?: boolean;
}) {
  if (context.hideActions) return null;

  const visible = context.showActions || context.forceShowActions;
  const tabIdx = visible ? undefined : -1;
  const saveMomentSource = buildSaveMomentSource({
    chatId: context.message.chatId,
    messageId: context.message.id,
    role: context.message.role,
    speakerName: context.displayName,
    createdAt: context.message.createdAt,
    content: translationContent,
  });

  return (
    <div
      className={cn(
        "mari-message-actions absolute -top-3 flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)]/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-all dark:border-white/20 dark:bg-black/40",
        className,
        visible
          ? "visible pointer-events-auto opacity-100"
          : "invisible pointer-events-none opacity-0 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 focus-within:visible focus-within:pointer-events-auto focus-within:opacity-100",
      )}
    >
      <MsgAction
        icon={context.copied ? "✓" : <Copy size="0.75rem" />}
        onClick={context.handleCopy}
        title="Copy"
        tabIndex={tabIdx}
      />
      <SaveMomentAction
        source={saveMomentSource}
        onCreateSummaryDraft={context.onSaveMomentSummary}
        onBranch={context.onBranch}
        buttonClassName="rounded p-1 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground"
        iconSize="0.75rem"
        tabIndex={tabIdx}
      />
      {context.onIllustrateMoment && (
        <IllustrateMomentAction
          source={saveMomentSource}
          onIllustrateMoment={context.onIllustrateMoment}
          buttonClassName="rounded p-1 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground"
          iconSize="0.75rem"
          tabIndex={tabIdx}
        />
      )}
      <MsgAction
        icon={<Languages size="0.75rem" />}
        onClick={() => context.onTranslate(translationContent)}
        title={context.translatedText ? "Hide translation" : "Translate"}
        className={context.translatedText ? "text-blue-400" : undefined}
        tabIndex={tabIdx}
      />
      {context.generationDurationLabel && (
        <MsgAction
          icon={<Timer size="0.75rem" />}
          onClick={() => undefined}
          title={context.generationDurationTitle}
          tabIndex={tabIdx}
        />
      )}
      <MsgAction icon={<Pencil size="0.75rem" />} onClick={context.onStartEdit} title="Edit" tabIndex={tabIdx} />
      {context.canRegenerate && context.onRegenerate && (
        <MsgAction
          icon={<RefreshCw size="0.75rem" />}
          onClick={() => context.onRegenerate?.(context.message.id)}
          title={context.regenerateButtonTitle}
          className={context.regenerateGuidedClass}
          tabIndex={tabIdx}
        />
      )}
      {!context.isUser && context.onPeekPrompt && (
        <MsgAction
          icon={<Eye size="0.75rem" />}
          onClick={() =>
            context.onPeekPrompt?.({
              forCharacterId: context.message.characterId ?? null,
              messageId: context.message.id,
              promptSnapshot: context.activePromptSnapshot,
            })
          }
          title="Peek prompt"
          tabIndex={tabIdx}
        />
      )}
      {context.onToggleHiddenFromAI && (
        <MsgAction
          icon={context.isHiddenFromAI ? <Eye size="0.75rem" /> : <EyeOff size="0.75rem" />}
          onClick={() => context.onToggleHiddenFromAI?.(context.message.id, context.isHiddenFromAI)}
          title={context.isHiddenFromAI ? "Unhide from AI" : "Hide from AI"}
          className={context.isHiddenFromAI ? "text-amber-500" : undefined}
          tabIndex={tabIdx}
        />
      )}
      {context.generationReplay && (
        <MsgAction
          icon={<ScrollText size="0.75rem" />}
          onClick={context.onShowGenerationReplay}
          title="Stored guidance"
          tabIndex={tabIdx}
        />
      )}
      {context.thinking && (!context.isUser || showUserThinking) && (
        <MsgAction
          icon={<Brain size="0.75rem" />}
          onClick={context.onShowThinking}
          title="View thoughts"
          tabIndex={tabIdx}
        />
      )}
      {context.onBranch && (
        <MsgAction
          icon={<GitBranch size="0.75rem" />}
          onClick={() => context.onBranch?.(context.message.id)}
          title="Branch from here"
          tabIndex={tabIdx}
        />
      )}
      {context.onDelete && (
        <MsgAction
          icon={<Trash2 size="0.75rem" />}
          onClick={() => context.onDelete?.(context.message.id)}
          title="Delete"
          className="hover:text-[var(--destructive)]"
          tabIndex={tabIdx}
        />
      )}
    </div>
  );
}

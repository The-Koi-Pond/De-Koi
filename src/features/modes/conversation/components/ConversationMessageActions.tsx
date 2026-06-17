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

  return (
    <div
      className={cn(
        "mari-message-actions absolute -top-3 flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)]/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-all dark:border-white/20 dark:bg-black/40",
        className,
        "opacity-0 group-hover:opacity-100",
        (context.showActions || context.forceShowActions) && "opacity-100",
      )}
    >
      <MsgAction icon={context.copied ? "✓" : <Copy size="0.75rem" />} onClick={context.handleCopy} title="Copy" />
      <MsgAction
        icon={<Languages size="0.75rem" />}
        onClick={() => context.onTranslate(translationContent)}
        title={context.translatedText ? "Hide translation" : "Translate"}
        className={context.translatedText ? "text-blue-400" : undefined}
      />
      {context.generationDurationLabel && (
        <MsgAction icon={<Timer size="0.75rem" />} onClick={() => undefined} title={context.generationDurationTitle} />
      )}
      <MsgAction icon={<Pencil size="0.75rem" />} onClick={context.onStartEdit} title="Edit" />
      {context.canRegenerate && (
        <MsgAction
          icon={<RefreshCw size="0.75rem" />}
          onClick={() => context.onRegenerate?.(context.message.id)}
          title={context.regenerateButtonTitle}
          className={context.regenerateGuidedClass}
        />
      )}
      {!context.isUser && (
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
        />
      )}
      {context.onToggleHiddenFromAI && (
        <MsgAction
          icon={context.isHiddenFromAI ? <Eye size="0.75rem" /> : <EyeOff size="0.75rem" />}
          onClick={() => context.onToggleHiddenFromAI?.(context.message.id, context.isHiddenFromAI)}
          title={context.isHiddenFromAI ? "Unhide from AI" : "Hide from AI"}
          className={context.isHiddenFromAI ? "text-amber-500" : undefined}
        />
      )}
      {context.generationReplay && (
        <MsgAction
          icon={<ScrollText size="0.75rem" />}
          onClick={context.onShowGenerationReplay}
          title="Stored guidance"
        />
      )}
      {context.thinking && (!context.isUser || showUserThinking) && (
        <MsgAction icon={<Brain size="0.75rem" />} onClick={context.onShowThinking} title="View thoughts" />
      )}
      {context.onBranch && (
        <MsgAction
          icon={<GitBranch size="0.75rem" />}
          onClick={() => context.onBranch?.(context.message.id)}
          title="Branch from here"
        />
      )}
      {context.onDelete && (
        <MsgAction
          icon={<Trash2 size="0.75rem" />}
          onClick={() => context.onDelete?.(context.message.id)}
          title="Delete"
          className="hover:text-[var(--destructive)]"
        />
      )}
    </div>
  );
}

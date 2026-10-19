import { SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  QUICK_REACTIONS,
  USER_REACTOR,
  readMessageReactions,
  withMessageReaction,
  type MessageReaction,
} from "../../../../engine/modes/chat/core/message-reactions";
import { useUpdateMessageExtra } from "../../../catalog/chats/index";
import { cn } from "../../../../shared/lib/utils";
import type { ConversationMessageRenderContext } from "./ConversationMessageShared";

function useToggleUserReaction(context: ConversationMessageRenderContext) {
  const updateExtra = useUpdateMessageExtra(context.message.chatId);
  return (emoji: string) => {
    const reactions = withMessageReaction(
      readMessageReactions(context.message.extra),
      USER_REACTOR,
      emoji,
      new Date().toISOString(),
    );
    updateExtra.mutate({ messageId: context.message.id, extra: { reactions } });
  };
}

/** Tapback chips under a message. Tapping your own reaction removes it. */
export function ConversationMessageReactions({ context }: { context: ConversationMessageRenderContext }) {
  const reactions = readMessageReactions(context.message.extra);
  const toggle = useToggleUserReaction(context);
  if (reactions.length === 0) return null;
  const groups = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction]);
  return (
    <div
      className={cn(
        "-mt-1 flex flex-wrap gap-1",
        context.isBubbleStyle && context.isUser ? "justify-end" : "justify-start",
      )}
      data-message-reactions
    >
      {[...groups].map(([emoji, group]) => {
        const mine = group.some((reaction) => reaction.by === USER_REACTOR);
        const who = group.map((reaction) => context.reactorName(reaction.by)).join(", ");
        const label = `${who} reacted ${emoji}${mine ? ". Tap to remove yours" : ""}`;
        return (
          <button
            key={emoji}
            type="button"
            title={label}
            aria-label={label}
            disabled={!mine}
            onClick={(event) => {
              event.stopPropagation();
              if (mine) toggle(emoji);
            }}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none shadow-sm",
              mine
                ? "border-[var(--primary)]/50 bg-[var(--primary)]/15 hover:bg-[var(--primary)]/25"
                : "border-[var(--border)] bg-[var(--card)] disabled:cursor-default",
            )}
          >
            <span aria-hidden>{emoji}</span>
            {group.length > 1 && <span className="text-[0.625rem] text-[var(--muted-foreground)]">{group.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** "React" button for the message action bar: quick tapback picks; picking your current one removes it. */
export function ConversationReactAction({
  context,
  tabIndex,
}: {
  context: ConversationMessageRenderContext;
  tabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggle = useToggleUserReaction(context);
  const current = readMessageReactions(context.message.extra).find((reaction) => reaction.by === USER_REACTOR);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="React"
        aria-label="React"
        aria-haspopup="true"
        aria-expanded={open}
        tabIndex={tabIndex}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          "rounded p-1 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground",
          current && "text-[var(--primary)]",
        )}
      >
        <SmilePlus size="0.75rem" />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Pick a reaction"
          className="absolute bottom-full left-1/2 z-30 mb-1.5 flex -translate-x-1/2 gap-0.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 shadow-lg"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={current?.emoji === emoji ? `Remove ${emoji}` : `React ${emoji}`}
              aria-pressed={current?.emoji === emoji}
              onClick={(event) => {
                event.stopPropagation();
                toggle(emoji);
                setOpen(false);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-base transition-transform hover:scale-125 hover:bg-foreground/10",
                current?.emoji === emoji && "bg-[var(--primary)]/20",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

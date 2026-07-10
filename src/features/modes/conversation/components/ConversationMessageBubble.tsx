import { cn } from "../../../../shared/lib/utils";
import { ConversationMessageActions } from "./ConversationMessageActions";
import {
  ConversationMessageAttachments,
  ConversationMessageAvatarColumn,
  ConversationMessageBodyContent,
  ConversationMessageMeta,
  ConversationMessageOverlays,
  ConversationMessageSwipeControl,
  ConversationMessageTranslation,
  MessageSelectCheckbox,
  type ConversationMessageRenderContext,
} from "./ConversationMessageShared";

export function ConversationMessageBubble({ context }: { context: ConversationMessageRenderContext }) {
  return (
    <div
      className={cn(
        "mari-message relative px-4 py-0.5 transition-colors",
        "block",
        context.isUser ? "mari-message-user" : "mari-message-assistant",
        !context.noHoverGroup && "group",
        context.isGrouped ? "mt-0" : "mt-3",
        context.isStreaming && "bg-[var(--secondary)]/20",
        context.multiSelectMode && context.isSelected && "bg-[var(--destructive)]/10",
      )}
      data-message-id={context.message.id}
      data-message-role={context.message.role}
      data-message-style={context.messageStyle}
      data-card-css={context.cardCssId}
      data-grouped={context.isGrouped || undefined}
      tabIndex={context.hideActions ? undefined : 0}
      onClick={context.handleMessageClick}
      onKeyDown={context.handleMessageKeyDown}
      onDoubleClick={context.handleMessageDoubleClick}
    >
      <div className={cn("flex items-end gap-2", context.isUser ? "justify-end" : "justify-start")}>
        {context.multiSelectMode && (
          <div className="flex items-center flex-shrink-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={context.isSelected}
              aria-label={context.isSelected ? "Deselect message" : "Select message"}
              className="border-0 bg-transparent p-0 text-inherit"
              onClick={(e) => {
                e.stopPropagation();
                context.onToggleSelect?.(e.shiftKey);
              }}
            >
              <MessageSelectCheckbox isSelected={context.isSelected} />
            </button>
          </div>
        )}

        <ConversationMessageAvatarColumn context={context} />

        <div
          className={cn(
            "mari-message-body min-w-0",
            "flex max-w-[72%] flex-none flex-col gap-1",
            context.isUser ? "items-end" : "items-start",
          )}
        >
          <ConversationMessageMeta context={context} />
          <ConversationMessageBodyContent context={context} />
          <ConversationMessageTranslation context={context} />
          <ConversationMessageAttachments context={context} className="mt-1.5 flex flex-col items-center gap-2" />
        </div>
      </div>

      {!context.hideActions && context.hasSwipes && (
        <div className={cn("mt-1", context.isUser ? "flex justify-end" : "pl-10")}>
          <ConversationMessageSwipeControl context={context} variant="bubble" />
        </div>
      )}

      <ConversationMessageActions
        context={context}
        className={context.isUser ? "right-4" : "left-12"}
        translationContent={context.renderedContent}
      />
      <ConversationMessageOverlays context={context} />
    </div>
  );
}

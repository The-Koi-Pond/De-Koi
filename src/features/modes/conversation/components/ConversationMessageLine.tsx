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

export function ConversationMessageLine({ context }: { context: ConversationMessageRenderContext }) {
  return (
    <div
      className={cn(
        "mari-message relative px-4 py-0.5 transition-colors",
        "flex gap-4 hover:bg-[var(--secondary)]/30",
        context.isUser ? "mari-message-user" : "mari-message-assistant",
        !context.noHoverGroup && "group",
        context.isGrouped ? "mt-0" : "mt-4",
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
      <div className="contents">
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

        <div className="mari-message-body min-w-0 flex-1">
          <ConversationMessageMeta context={context} />
          <ConversationMessageBodyContent context={context} />
          <ConversationMessageTranslation context={context} />
          <ConversationMessageAttachments context={context} className="mt-1.5 flex flex-col items-center gap-2" />
          <ConversationMessageSwipeControl context={context} variant="line" />
        </div>
      </div>

      <ConversationMessageActions context={context} className="right-4" translationContent={context.renderedContent} />
      <ConversationMessageOverlays context={context} />
    </div>
  );
}

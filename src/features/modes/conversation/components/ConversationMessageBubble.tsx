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
  MessageContent,
  MessageSelectCheckbox,
  nameColorStyle,
  type ConversationMessageRenderContext,
} from "./ConversationMessageShared";

function ConversationMessageGroupedBubbleContent({ context }: { context: ConversationMessageRenderContext }) {
  if (!context.groupedSegments || context.isUser) return null;

  return (
    <div className="space-y-2">
      {context.groupedSegments.slice(0, context.visibleSegments).map((grp, index) => {
        const combinedText = grp.lines.join("\n");
        const segChar = grp.speaker && context.charByName ? context.charByName.get(grp.speaker.toLowerCase()) : null;
        const segName = segChar?.name ?? grp.speaker ?? "";
        const segColor = segChar?.nameColor;
        const segDialogueColor = segChar?.dialogueColor;

        if (!grp.speaker) {
          return (
            <div
              key={index}
              className={cn(
                "text-[0.875rem] italic text-[var(--muted-foreground)]",
                index > 0 && "border-t border-[var(--border)]/40 pt-2",
              )}
            >
              <MessageContent
                content={combinedText}
                mentionNames={context.mentionNames}
                onImageOpen={context.onImageOpen}
                quoteFormat={context.quoteFormat}
              />
            </div>
          );
        }

        return (
          <div key={index} className={cn("min-w-0", index > 0 && "border-t border-[var(--border)]/40 pt-2")}>
            <div className="mb-1 text-[0.75rem] font-semibold leading-tight" style={nameColorStyle(segColor)}>
              {segName}
            </div>
            <MessageContent
              content={combinedText}
              mentionNames={context.mentionNames}
              onImageOpen={context.onImageOpen}
              dialogueColor={segDialogueColor}
              quoteFormat={context.quoteFormat}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ConversationMessageBubble({ context }: { context: ConversationMessageRenderContext }) {
  const groupedBubbleContent =
    context.groupedSegments && !context.isUser ? <ConversationMessageGroupedBubbleContent context={context} /> : null;

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
          <ConversationMessageBodyContent context={context} groupedBubbleContent={groupedBubbleContent} />
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

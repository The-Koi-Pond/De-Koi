import { cn } from "../../../../shared/lib/utils";
import { ConversationMessageActions } from "./ConversationMessageActions";
import {
  ConversationMessageAttachments,
  ConversationMessageOverlays,
  ConversationMessageSwipeControl,
  ConversationMessageTranslation,
  formatTimestamp,
  MessageSelectCheckbox,
  nameColorStyle,
  renderInlineMessageText,
  resolveConversationAvatar,
  type ConversationMessageRenderContext,
} from "./ConversationMessageShared";
import { ResolvedAvatarImage } from "../../shared/chat-ui/index";

export function ConversationMessageGrouped({ context }: { context: ConversationMessageRenderContext }) {
  if (context.isHiddenCollapsed) {
    return (
      <div
        className={cn(
          "relative px-4 py-0.5 transition-colors hover:bg-[var(--secondary)]/30",
          !context.noHoverGroup && "group",
          context.isGrouped ? "mt-0" : "mt-3",
        )}
        data-message-id={context.message.id}
        data-message-role={context.message.role}
      >
        <div className="ml-14 flex items-center gap-2 py-1">{context.hiddenFromAIHeader}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative px-4 py-0.5 transition-colors hover:bg-[var(--secondary)]/30",
        !context.noHoverGroup && "group",
        context.isGrouped ? "mt-0" : "mt-3",
        context.isStreaming && "bg-[var(--secondary)]/20",
        context.multiSelectMode && context.isSelected && "bg-[var(--destructive)]/10",
      )}
      data-message-id={context.message.id}
      data-message-role={context.message.role}
      data-card-css={context.cardCssId}
      data-grouped={context.isGrouped || undefined}
      tabIndex={context.hideActions ? undefined : 0}
      onClick={context.handleMessageClick}
      onKeyDown={context.handleMessageKeyDown}
      onDoubleClick={context.handleMessageDoubleClick}
    >
      {context.multiSelectMode && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
          <button
            type="button"
            role="checkbox"
            aria-checked={context.isSelected}
            aria-label={context.isSelected ? "Deselect message" : "Select message"}
            className="block border-0 bg-transparent p-0 text-inherit"
            onClick={(e) => {
              e.stopPropagation();
              context.onToggleSelect?.(e.shiftKey);
            }}
          >
            <MessageSelectCheckbox isSelected={context.isSelected} />
          </button>
        </div>
      )}

      {context.groupedSegments?.slice(0, context.visibleSegments).map((grp, i) => {
        const segChar = grp.speaker && context.charByName ? context.charByName.get(grp.speaker.toLowerCase()) : null;
        const segAvatar = segChar?.avatarUrl ?? null;
        const segName = segChar?.name ?? grp.speaker ?? "";
        const segColor = segChar?.nameColor;
        const segAvatarOverride = resolveConversationAvatar(segChar, segAvatar);
        const isFirst = i === 0;
        const combinedText = grp.lines.join("\n");

        if (!grp.speaker) {
          return (
            <div
              key={i}
              className="pl-14 py-0.5 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap text-[var(--muted-foreground)] italic animate-[fadeSlideIn_0.4s_ease-out]"
              style={context.messageTextStyle}
            >
              {renderInlineMessageText(combinedText, context.mentionNames, `ns${i}`)}
            </div>
          );
        }

        return (
          <div key={i} className={cn("animate-[fadeSlideIn_0.4s_ease-out]", i > 0 && "mt-3")}>
            {(() => {
              const paragraphs = combinedText
                .split(/\n{2,}/)
                .map((p) => p.trim())
                .filter(Boolean);
              if (paragraphs.length === 0) return null;
              return (
                <>
                  <div className="flex gap-4">
                    <div className="w-10 flex-shrink-0">
                      {!segAvatarOverride.hide && (
                        <div className="relative h-10 w-10 overflow-hidden rounded-full bg-[var(--accent)]">
                          {segAvatarOverride.emoji ? (
                            <div className="flex h-full w-full items-center justify-center text-2xl leading-none">
                              {segAvatarOverride.emoji}
                            </div>
                          ) : segAvatarOverride.url ? (
                            <ResolvedAvatarImage
                              src={segAvatarOverride.url}
                              avatarFilePath={segAvatarOverride.isOverride ? null : (segChar?.avatarFilePath ?? null)}
                              avatarFilename={segAvatarOverride.isOverride ? null : (segChar?.avatarFilename ?? null)}
                              alt={segName}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                              crop={segAvatarOverride.isOverride ? null : segChar?.avatarCrop}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                              {segName[0]?.toUpperCase()}
                            </div>
                          )}
                        </div>
                      )}
                      {isFirst &&
                        (context.showActions || context.forceShowActions || context.showMessageNumbers) &&
                        context.messageIndex != null && (
                          <span className="mt-0.5 block text-center text-[0.5rem] font-medium text-[var(--muted-foreground)] select-none">
                            #{context.messageIndex}
                          </span>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span
                          className="text-[0.9375rem] font-semibold leading-tight hover:underline cursor-default"
                          style={nameColorStyle(segColor)}
                        >
                          {segName}
                        </span>
                        {isFirst && !context.hideTimestamp && (
                          <span className="text-[0.6875rem] text-[var(--muted-foreground)]/60">
                            {formatTimestamp(context.message.createdAt)}
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap"
                        style={context.messageTextStyle}
                      >
                        {renderInlineMessageText(paragraphs[0]!, context.mentionNames, `gs${i}_0`)}
                      </div>
                    </div>
                  </div>
                  {paragraphs.slice(1).map((para, pi) => (
                    <div
                      key={pi}
                      className="pl-14 mt-0.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap"
                      style={context.messageTextStyle}
                    >
                      {renderInlineMessageText(para, context.mentionNames, `gs${i}_${pi + 1}`)}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        );
      })}

      {context.isStreaming && (
        <span className="ml-14 inline-block h-4 w-[0.125rem] animate-pulse rounded-full bg-[var(--foreground)]/50" />
      )}

      <div className="ml-14">
        <ConversationMessageTranslation context={context} />
      </div>
      <ConversationMessageAttachments context={context} className="ml-14 mt-1.5 flex flex-col items-start gap-2" />
      <ConversationMessageSwipeControl context={context} variant="grouped" />
      <ConversationMessageActions
        context={context}
        className="right-4"
        translationContent={context.message.content}
        showUserThinking
      />
      <ConversationMessageOverlays context={context} />
    </div>
  );
}

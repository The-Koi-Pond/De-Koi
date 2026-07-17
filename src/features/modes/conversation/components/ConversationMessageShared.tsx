import { memo, useMemo, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Brain, ChevronRight, EyeOff, RefreshCw, Trash2, User, X } from "lucide-react";
import type { Message, MessageAttachment, MessageExtra, MessageSwipe } from "../../../../engine/contracts/types/chat";
import type { ConversationAvatarOverride } from "../../../../engine/contracts/types/character";
import { formatTextQuotes, type QuoteFormat } from "../../../../shared/lib/dialogue-quotes";
import { applyTextareaQuoteFormat } from "../../../../shared/lib/textarea-quotes";
import { cn, type AvatarCropValue } from "../../../../shared/lib/utils";
import { applyInlineMarkdown, renderMarkdownBlocks } from "../../../../shared/lib/markdown";
import type { ConversationMessageStyle } from "../../../../shared/stores/ui.store";
import type { CharacterMap, MessageSelectionToggle, PeekPromptOptions, PersonaInfo } from "../../shared/chat-ui/types";
import type { SaveMomentSource } from "../../shared/chat-ui/index";
import {
  GenerationReplayDetailsModal,
  ImagePromptPanel,
  isImageMessageAttachment,
  MessageAttachmentImagePreview,
  MessageMemoryIndicators,
  ResolvedAvatarImage,
  SwipeJumpControl,
} from "../../shared/chat-ui/index";

const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?[^\s]*)?$/i;
export const MESSAGE_EDIT_GESTURE_IGNORE_SELECTOR =
  "button, a, textarea, input, select, label, [role='button'], [contenteditable='true'], .mari-message-actions";

export type ConversationMessageExtra = Partial<MessageExtra> & { hiddenFromAI?: unknown; hiddenFromAi?: unknown };
export const EMPTY_MESSAGE_EXTRA: ConversationMessageExtra = {};
type ConversationMessageData = Omit<Message, "extra"> & {
  extra: ConversationMessageExtra | string;
  swipes?: Array<Pick<MessageSwipe, "content" | "extra" | "characterId"> & { id?: string }>;
};

export interface ConversationMessageProps {
  message: ConversationMessageData;
  isStreaming?: boolean;
  isGrouped?: boolean;
  hideActions?: boolean;
  hideUserAvatar?: boolean;
  hideTimestamp?: boolean;
  noHoverGroup?: boolean;
  plainUserMessages?: boolean;
  forceShowActions?: boolean;
  forceCanRegenerate?: boolean;
  regenerateButtonTitle?: string;
  onDelete?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void | Promise<void>;
  onSetActiveSwipe?: (messageId: string, index: number) => void;
  onPeekPrompt?: (options?: PeekPromptOptions) => void;
  onToggleHiddenFromAI?: (messageId: string, current: boolean) => void;
  onBranch?: (messageId: string) => void;
  onOpenCharacterProfile?: (characterId: string, anchorRect: DOMRect) => void;
  onSaveMomentSummary?: (source: SaveMomentSource) => void;
  onIllustrateMoment?: (source: SaveMomentSource) => void | Promise<void>;
  isLastAssistantMessage?: boolean;
  characterMap?: CharacterMap;
  personaInfo?: PersonaInfo;
  onEditClick?: () => void;
  chatCharacterIds?: string[];
  messageIndex?: number;
  messageOrderIndex?: number;
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (toggle: MessageSelectionToggle) => void;
  suppressCardCss?: boolean;
  messageStyle?: ConversationMessageStyle;
  contentParts?: string[];
  visiblePartCount?: number;
  bubbleGroupPosition?: "single" | "first" | "middle" | "last";
  originalContent?: string;
  typingLabel?: string;
}

export interface ConversationAvatarRender {
  hide: boolean;
  emoji: string | null;
  url: string | null;
  isOverride: boolean;
}

export interface ConversationMessageRenderContext {
  message: ConversationMessageData;
  cardCssId?: string;
  messageStyle: ConversationMessageStyle;
  isStreaming?: boolean;
  isGrouped?: boolean;
  hideActions?: boolean;
  hideTimestamp: boolean;
  noHoverGroup?: boolean;
  forceShowActions?: boolean;
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
  handleMessageKeyDown?: (event: React.KeyboardEvent) => void;
  messageIndex?: number;
  showActions: boolean;
  showMessageNumbers: boolean;
  isUser: boolean;
  isBubbleStyle: boolean;
  isHiddenFromAI: boolean;
  isHiddenCollapsed: boolean;
  hiddenFromAIHeader: ReactNode;
  canRegenerate: boolean;
  editing: boolean;
  editRef: RefObject<HTMLTextAreaElement | null>;
  editValue: string;
  editSaving: boolean;
  editError: string | null;
  quoteFormat: QuoteFormat;
  setEditValue: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void | Promise<void>;
  messageTextStyle: CSSProperties;
  displayName: string;
  nameColor?: string;
  conversationAvatar: ConversationAvatarRender;
  avatarUrl: string | null;
  avatarFilePath: string | null;
  avatarFilename: string | null;
  avatarCrop?: AvatarCropValue | null;
  shouldHideUserAvatarGraphic: boolean;
  shouldHideAvatarColumn: boolean;
  shouldShowMessageNumber: boolean;
  renderedContent: string;
  renderedContentParts: string[] | null;
  hasRenderedContent: boolean;
  typingLabel?: string;
  mentionNames: string[];
  attachments: MessageAttachment[];
  translatedText?: string | null;
  isTranslating: boolean;
  hasSwipes: boolean;
  swipeCount: number;
  bubbleCornerClass: string;
  generationDurationLabel: string | null;
  generationDurationTitle: string;
  regenerateButtonTitle: string;
  regenerateGuidedClass?: string;
  thinking: string | null;
  generationReplay: MessageExtra["generationReplay"] | null;
  memoryCapture: MessageExtra["memoryCapture"] | null;
  activePromptSnapshot: Message["extra"]["generationPromptSnapshot"] | null;
  copied: boolean;
  handleMessageClick: (event: MouseEvent) => void;
  handleMessageDoubleClick: (event: MouseEvent) => void;
  handleCopy: () => void;
  onTranslate: (content: string) => void;
  onCancelTranslation: () => void;
  onStartEdit: () => void;
  onRegenerate?: (messageId: string) => void;
  onSetActiveSwipe?: (messageId: string, index: number) => void;
  onPeekPrompt?: (options?: PeekPromptOptions) => void;
  onToggleHiddenFromAI?: (messageId: string, current: boolean) => void;
  onBranch?: (messageId: string) => void;
  onOpenCharacterProfile?: (characterId: string, anchorRect: DOMRect) => void;
  canOpenCharacterProfile?: boolean;
  onSaveMomentSummary?: (source: SaveMomentSource) => void;
  onIllustrateMoment?: (source: SaveMomentSource) => void | Promise<void>;
  onDelete?: (messageId: string) => void;
  onShowGenerationReplay: () => void;
  onShowThinking: () => void;
  onImageOpen: (url: string, prompt?: string | null) => void;
  onRemoveAttachment: (index: number) => void | Promise<void>;
  onRegenerateAttachment?: (index: number) => void | Promise<void>;
  onCloseThinking: () => void;
  onCloseGenerationReplay: () => void;
  imageLightbox: { url: string; prompt?: string | null } | null;
  onCloseImageLightbox: () => void;
  showThinking: boolean;
  showGenerationReplay: boolean;
}

function nameColorStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;
  if (color.includes("gradient(")) {
    return {
      backgroundImage: color,
      backgroundRepeat: "no-repeat",
      backgroundSize: "100% 100%",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      color: "transparent",
      display: "inline-block",
    };
  }
  return { color };
}

export function formatGenerationDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function readGenerationDurationMs(generationInfo: unknown): number | null {
  if (!generationInfo || typeof generationInfo !== "object") return null;
  const record = generationInfo as { duration?: unknown; durationMs?: unknown };
  if (typeof record.durationMs === "number" && record.durationMs > 0) return record.durationMs;
  if (typeof record.duration === "number" && record.duration > 0) return record.duration * 1000;
  return null;
}

export function resolveConversationAvatar(
  info: { conversationAvatar?: ConversationAvatarOverride; conversationAvatarSrc?: string | null } | null | undefined,
  fallbackUrl: string | null,
): ConversationAvatarRender {
  const override = info?.conversationAvatar;
  if (!override || override.mode === "default") {
    return { hide: false, emoji: null, url: fallbackUrl, isOverride: false };
  }
  if (override.mode === "hide") return { hide: true, emoji: null, url: null, isOverride: true };
  if (override.mode === "emoji") {
    return { hide: false, emoji: override.value?.trim() || null, url: null, isOverride: true };
  }
  const resolved = info?.conversationAvatarSrc ?? null;
  return { hide: false, emoji: null, url: resolved ?? fallbackUrl, isOverride: !!resolved };
}

function formatTimestamp(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    if (diffDays === 0 && date.getDate() === now.getDate()) return `Today at ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (diffDays <= 1 && date.getDate() === yesterday.getDate()) return `Yesterday at ${time}`;
    return `${date.toLocaleDateString()} ${time}`;
  } catch {
    return "";
  }
}

function highlightMentions(nodes: ReactNode[], names: string[], keyPrefix: string): ReactNode[] {
  if (names.length === 0) return nodes;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(@(?:${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))(\\b|(?=[^\\w])|$)`,
    "gi",
  );
  let key = 0;
  return nodes.flatMap((node) => {
    if (typeof node !== "string") return [node];
    const parts: ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(node)) !== null) {
      if (m.index > lastIdx) parts.push(node.slice(lastIdx, m.index));
      parts.push(
        <span
          key={`${keyPrefix}at${key++}`}
          className="mention-highlight rounded-[3px] bg-[var(--primary)]/15 px-px text-[var(--primary)] font-medium hover:bg-[var(--primary)]/25 cursor-default"
        >
          {m[1]}
        </span>,
      );
      lastIdx = m.index + m[1]!.length;
      pattern.lastIndex = lastIdx;
    }
    if (lastIdx < node.length) parts.push(node.slice(lastIdx));
    return parts.length > 0 ? parts : [node];
  });
}

function renderInlineMessageTextSegment(content: string, mentionNames: string[], keyPrefix: string): ReactNode[] {
  return mentionNames.length
    ? highlightMentions(applyInlineMarkdown(content, keyPrefix), mentionNames, keyPrefix)
    : applyInlineMarkdown(content, keyPrefix);
}

function renderInlineMessageText(
  content: string,
  mentionNames: string[],
  keyPrefix: string,
  quoteFormat: QuoteFormat = "straight",
): ReactNode[] {
  return renderInlineMessageTextSegment(formatTextQuotes(content, quoteFormat), mentionNames, keyPrefix);
}

const MessageContent = memo(function MessageContent({
  content,
  mentionNames,
  onImageOpen,
  quoteFormat,
}: {
  content: string;
  mentionNames?: string[];
  onImageOpen: (url: string) => void;
  quoteFormat: QuoteFormat;
}) {
  const trimmed = content.trim();
  const isImage = IMAGE_URL_RE.test(trimmed);

  const rendered = useMemo(() => {
    if (isImage) return null;
    const compacted = content.replace(/\n{3,}/g, "\n\n");
    const renderInline = (text: string, kp: string) =>
      renderInlineMessageText(text, mentionNames ?? [], kp, quoteFormat);
    return renderMarkdownBlocks(compacted, renderInline);
  }, [content, isImage, mentionNames, quoteFormat]);

  if (isImage) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onImageOpen(trimmed);
        }}
        className="block cursor-zoom-in rounded-lg text-left"
        title="Open image"
      >
        <img src={trimmed} alt="GIF" className="max-h-48 max-w-full sm:max-w-xs rounded-lg" loading="lazy" />
      </button>
    );
  }

  return <>{rendered}</>;
});

export function HiddenFromAIConversationButton({
  canCollapse,
  isExpanded,
  onToggle,
}: {
  canCollapse: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const className = "inline-flex items-center gap-1 rounded px-1 py-0.5 text-[0.625rem] font-medium text-amber-500/80";
  if (!canCollapse) {
    return (
      <span className={className} title="Hidden from AI">
        <EyeOff size="0.7rem" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`${className} transition-colors hover:bg-amber-500/10 hover:text-amber-400`}
      title={isExpanded ? "Collapse hidden from AI message" : "Expand hidden from AI message"}
      aria-label={isExpanded ? "Collapse hidden from AI message" : "Expand hidden from AI message"}
    >
      <ChevronRight size="0.7rem" className={cn("transition-transform", isExpanded && "rotate-90")} />
      <EyeOff size="0.7rem" />
    </button>
  );
}

export function MsgAction({
  icon,
  onClick,
  title,
  className,
  tabIndex,
}: {
  icon: ReactNode;
  onClick: () => void;
  title: string;
  className?: string;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      tabIndex={tabIndex}
      className={cn(
        "rounded p-1 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground",
        className,
      )}
    >
      {icon}
    </button>
  );
}

export function MessageSelectCheckbox({ isSelected }: { isSelected?: boolean }) {
  return (
    <div
      className={cn(
        "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer",
        isSelected
          ? "border-[var(--destructive)] bg-[var(--destructive)]"
          : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)]",
      )}
    >
      {isSelected && <span className="text-white text-xs font-bold">✓</span>}
    </div>
  );
}

function StreamingPendingIndicator({
  label,
  displayName,
  className,
}: {
  label?: string;
  displayName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mari-streaming-pending inline-flex items-center gap-2 py-0.5",
        label && "mari-typing-indicator",
        className,
      )}
      data-typing-name={label ? displayName : undefined}
      aria-label={label ?? "Assistant response is starting"}
    >
      <span className="mari-streaming-pending-glow" aria-hidden="true" />
      <span className="mari-streaming-pending-line" aria-hidden="true" />
      {label && <span className="mari-typing-text text-[0.8125rem] italic text-[var(--text-secondary)]">{label}</span>}
    </div>
  );
}

function StreamingReveal({ children }: { children: ReactNode }) {
  return <div className="mari-streaming-reveal">{children}</div>;
}
function ConversationMessageEditForm({ context }: { context: ConversationMessageRenderContext }) {
  return (
    <div className="space-y-2">
      <textarea
        ref={context.editRef}
        value={context.editValue}
        onChange={(e) => {
          const el = e.currentTarget;
          context.setEditValue(applyTextareaQuoteFormat(el, context.quoteFormat));
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
        }}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.9375rem] leading-relaxed outline-none"
        rows={1}
        style={{ overflow: "auto", ...context.messageTextStyle }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (!context.editSaving) context.onCancelEdit();
          }
        }}
        disabled={context.editSaving}
      />
      {context.editError && <div className="text-[0.6875rem] text-red-300/90">{context.editError}</div>}
      <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
        <button
          onClick={() => {
            if (!context.editSaving) context.onCancelEdit();
          }}
          disabled={context.editSaving}
          className="text-foreground/70 hover:underline hover:text-foreground"
        >
          cancel
        </button>
        <span>·</span>
        <button
          onClick={() => void context.onSaveEdit()}
          disabled={context.editSaving}
          className="text-foreground/70 hover:underline hover:text-foreground"
        >
          {context.editSaving ? "saving" : "save"}
        </button>
      </div>
    </div>
  );
}

export function ConversationMessageBodyContent({
  context,
  groupedBubbleContent,
}: {
  context: ConversationMessageRenderContext;
  groupedBubbleContent?: ReactNode;
}) {
  if (context.isHiddenCollapsed) return null;
  if (context.editing) return <ConversationMessageEditForm context={context} />;

  return (
    <div
      className={cn(
        "mari-message-content text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap",
        context.isBubbleStyle && "mari-message-bubble texting-bubble relative min-w-0 max-w-full px-3.5 py-2 shadow-sm",
        context.isBubbleStyle && (context.isUser ? "texting-bubble-user" : "texting-bubble-other"),
        context.isBubbleStyle && context.bubbleCornerClass,
        (context.isStreaming || context.typingLabel) &&
          !context.hasRenderedContent &&
          (context.isBubbleStyle ? "py-2.5" : "py-1"),
      )}
      style={context.messageTextStyle}
    >
      {!context.hasRenderedContent && context.typingLabel ? (
        <StreamingPendingIndicator label={context.typingLabel} displayName={context.displayName} />
      ) : context.isStreaming && !context.hasRenderedContent ? (
        <StreamingPendingIndicator />
      ) : (
        <>
          {context.isStreaming ? (
            <StreamingReveal>
              {groupedBubbleContent ? (
                groupedBubbleContent
              ) : context.renderedContentParts ? (
                <div className="space-y-1.5">
                  {context.renderedContentParts.map((part, index) => (
                    <div key={index} className="animate-[fadeSlideIn_0.4s_ease-out]">
                      <MessageContent
                        content={part}
                        mentionNames={context.mentionNames}
                        onImageOpen={context.onImageOpen}
                        quoteFormat={context.quoteFormat}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <MessageContent
                  content={context.renderedContent}
                  mentionNames={context.mentionNames}
                  onImageOpen={context.onImageOpen}
                  quoteFormat={context.quoteFormat}
                />
              )}
            </StreamingReveal>
          ) : groupedBubbleContent ? (
            groupedBubbleContent
          ) : context.renderedContentParts ? (
            <div className="space-y-1.5">
              {context.renderedContentParts.map((part, index) => (
                <div key={index} className="animate-[fadeSlideIn_0.4s_ease-out]">
                  <MessageContent
                    content={part}
                    mentionNames={context.mentionNames}
                    onImageOpen={context.onImageOpen}
                    quoteFormat={context.quoteFormat}
                  />
                </div>
              ))}
            </div>
          ) : (
            <MessageContent
              content={context.renderedContent}
              mentionNames={context.mentionNames}
              onImageOpen={context.onImageOpen}
              quoteFormat={context.quoteFormat}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ConversationMessageTranslation({ context }: { context: ConversationMessageRenderContext }) {
  if (context.isHiddenCollapsed || (!context.translatedText && !context.isTranslating)) return null;
  return (
    <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
      {context.isTranslating ? (
        <div className="flex items-center gap-2">
          <span className="text-[0.75rem] italic text-[var(--muted-foreground)]">Translating…</span>
          <button
            type="button"
            onClick={context.onCancelTranslation}
            className="text-[0.6875rem] font-medium text-[var(--primary)] hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
          {context.translatedText}
        </div>
      )}
    </div>
  );
}

export function ConversationMessageAttachments({
  context,
  className,
}: {
  context: ConversationMessageRenderContext;
  className: string;
}) {
  if (
    context.isHiddenCollapsed ||
    context.attachments.length === 0 ||
    IMAGE_URL_RE.test(context.renderedContent.trim())
  ) {
    return null;
  }

  return (
    <div className={className}>
      {context.attachments.map((att, i) =>
        isImageMessageAttachment(att) ? (
          <MessageAttachmentImagePreview
            key={i}
            attachment={att}
            className="group/att relative inline-block"
            buttonClassName="block cursor-zoom-in rounded-lg text-left"
            imageClassName="max-h-80 max-w-full rounded-lg"
            onOpen={(imageSource, event) => {
              event.stopPropagation();
              context.onImageOpen(imageSource, att.prompt);
            }}
          >
            {context.onRegenerateAttachment && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void context.onRegenerateAttachment?.(i);
                }}
                aria-label="Regenerate image"
                title="Regenerate image"
                className="absolute top-1.5 right-9 rounded-full bg-black/60 p-1 text-white/80 transition-opacity hover:bg-black/80 hover:text-white sm:opacity-0 sm:group-hover/att:opacity-100"
              >
                <RefreshCw size="0.875rem" />
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void context.onRemoveAttachment(i);
              }}
              aria-label="Remove image"
              title="Remove image"
              className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white/80 transition-opacity hover:bg-black/80 hover:text-white sm:opacity-0 sm:group-hover/att:opacity-100"
            >
              <X size="0.875rem" />
            </button>
          </MessageAttachmentImagePreview>
        ) : null,
      )}
    </div>
  );
}

export function ConversationMessageSwipeControl({
  context,
  variant,
}: {
  context: ConversationMessageRenderContext;
  variant: "grouped" | "line" | "bubble";
}) {
  if (context.hideActions || !context.hasSwipes) return null;

  const className =
    variant === "grouped"
      ? "ml-14 mt-2 px-1 text-[0.6875rem] text-[var(--muted-foreground)]"
      : variant === "line"
        ? "mt-1.5 text-[0.6875rem] text-[var(--muted-foreground)]"
        : "rounded-full bg-[var(--card)]/70 px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] shadow-sm ring-1 ring-[var(--border)]/70";
  const inputClassName =
    variant === "bubble"
      ? "h-[1.375rem] w-[2.75rem] rounded-full text-[0.6875rem]"
      : "h-[1.5rem] w-[3rem] text-[0.6875rem]";
  const buttonClassName =
    variant === "bubble"
      ? "rounded-full p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
      : "rounded p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30";

  return (
    <SwipeJumpControl
      activeSwipeIndex={context.message.activeSwipeIndex}
      swipeCount={context.swipeCount}
      onSetActiveSwipe={(index) => context.onSetActiveSwipe?.(context.message.id, index)}
      onCreateNextSwipe={context.onRegenerate ? () => context.onRegenerate?.(context.message.id) : undefined}
      className={className}
      buttonClassName={buttonClassName}
      inputClassName={inputClassName}
    />
  );
}

export function ConversationMessageAvatarColumn({ context }: { context: ConversationMessageRenderContext }) {
  return (
    <div
      className={cn(
        "mari-message-avatar flex-shrink-0",
        context.isBubbleStyle ? "w-8 self-end" : "w-10",
        context.shouldHideAvatarColumn && "hidden",
      )}
    >
      {!context.isGrouped && (
        <>
          {!context.conversationAvatar.hide && !context.shouldHideUserAvatarGraphic && (
            <div
              className={cn(
                "relative overflow-hidden rounded-full bg-[var(--accent)]",
                context.isBubbleStyle ? "h-8 w-8" : "h-10 w-10",
              )}
            >
              {context.conversationAvatar.emoji ? (
                <div className="flex h-full w-full items-center justify-center text-2xl leading-none">
                  {context.conversationAvatar.emoji}
                </div>
              ) : context.conversationAvatar.isOverride && context.conversationAvatar.url ? (
                <img
                  src={context.conversationAvatar.url}
                  alt={context.displayName}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : context.avatarUrl ? (
                <ResolvedAvatarImage
                  src={context.avatarUrl}
                  avatarFilePath={context.avatarFilePath}
                  avatarFilename={context.avatarFilename}
                  alt={context.displayName}
                  loading="lazy"
                  decoding="async"
                  thumbnailSize={128}
                  className="h-full w-full object-cover"
                  crop={context.avatarCrop}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                  {context.isUser ? <User size="1.125rem" /> : context.displayName[0]?.toUpperCase()}
                </div>
              )}
            </div>
          )}
          {context.shouldShowMessageNumber && (
            <span className="mt-0.5 block text-center text-[0.5rem] font-medium text-[var(--muted-foreground)] select-none">
              #{context.messageIndex}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function ConversationMessageMeta({ context }: { context: ConversationMessageRenderContext }) {
  const showName = !context.isGrouped && !(context.isBubbleStyle && context.isUser && !context.hiddenFromAIHeader);
  if (!showName && context.hideTimestamp && !context.hiddenFromAIHeader) return null;
  return (
    <div className={cn("mari-message-meta flex items-baseline gap-2 mb-0.5", context.isBubbleStyle && "px-2")}>
      {context.hiddenFromAIHeader}
      {showName &&
        (context.canOpenCharacterProfile && context.onOpenCharacterProfile && context.message.characterId ? (
          <button
            type="button"
            className="mari-message-name cursor-pointer border-0 bg-transparent p-0 text-left text-[0.9375rem] font-semibold leading-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/60"
            style={nameColorStyle(context.nameColor)}
            aria-label={`Open ${context.displayName} profile`}
            onClick={(event) => {
              event.stopPropagation();
              context.onOpenCharacterProfile?.(
                context.message.characterId!,
                event.currentTarget.getBoundingClientRect(),
              );
            }}
          >
            {context.displayName}
          </button>
        ) : (
          <span
            className="mari-message-name text-[0.9375rem] font-semibold leading-tight hover:underline cursor-default"
            style={nameColorStyle(context.nameColor)}
          >
            {context.displayName}
          </span>
        ))}
      {!context.hideTimestamp && (
        <span className="mari-message-timestamp text-[0.6875rem] text-[var(--muted-foreground)]/60">
          {formatTimestamp(context.message.createdAt)}
        </span>
      )}
      <MessageMemoryIndicators
        isUser={context.isUser}
        memoryCapture={context.memoryCapture ?? null}
        promptSnapshot={context.activePromptSnapshot}
        onPeekPrompt={
          context.onPeekPrompt
            ? () => {
                context.onPeekPrompt?.({
                  forCharacterId: context.message.characterId ?? null,
                  messageId: context.message.id,
                  promptSnapshot: context.activePromptSnapshot ?? null,
                });
              }
            : null
        }
      />
    </div>
  );
}

export function ConversationMessageSystem({ context }: { context: ConversationMessageRenderContext }) {
  return (
    <div
      className={cn(
        "group flex justify-center py-1",
        context.multiSelectMode && context.isSelected && "rounded-lg bg-[var(--destructive)]/10",
      )}
      onClick={context.handleMessageClick}
      onDoubleClick={context.handleMessageDoubleClick}
    >
      <div className="relative">
        {!context.multiSelectMode && context.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              context.onDelete?.(context.message.id);
            }}
            className={cn(
              "absolute -right-1 -top-1 rounded-md p-1 text-[var(--muted-foreground)]/30 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100",
              context.showActions && "opacity-100",
            )}
            title="Delete"
          >
            <Trash2 size="0.75rem" />
          </button>
        )}
        <span className="rounded-full bg-[var(--secondary)] px-3 py-1 text-[0.6875rem] text-[var(--muted-foreground)]">
          {context.message.content}
        </span>
      </div>
    </div>
  );
}

export function ConversationMessageOverlays({
  context,
  includeImageLightbox = true,
}: {
  context: ConversationMessageRenderContext;
  includeImageLightbox?: boolean;
}) {
  return (
    <>
      {context.showThinking &&
        context.thinking &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
            onClick={context.onCloseThinking}
          >
            <div
              className="relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Brain size="0.875rem" className="text-[var(--muted-foreground)]" />
                  Model Thoughts
                </div>
                <button
                  onClick={context.onCloseThinking}
                  className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                >
                  <X size="0.875rem" />
                </button>
              </div>
              <div className="overflow-y-auto px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                  {context.thinking}
                </pre>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {context.generationReplay && (
        <GenerationReplayDetailsModal
          open={context.showGenerationReplay}
          replay={context.generationReplay}
          onClose={context.onCloseGenerationReplay}
        />
      )}
      {includeImageLightbox &&
        context.imageLightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
            onClick={context.onCloseImageLightbox}
          >
            <div
              className="flex max-h-[90vh] w-[min(90vw,64rem)] max-w-[90vw] flex-col items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={context.imageLightbox.url}
                alt="Expanded image"
                className={
                  context.imageLightbox.prompt?.trim()
                    ? "max-h-[calc(90vh-9rem)] max-w-full rounded-lg object-contain shadow-2xl"
                    : "max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
                }
              />
              <ImagePromptPanel prompt={context.imageLightbox.prompt} className="w-full max-w-3xl" />
            </div>
            <button
              onClick={context.onCloseImageLightbox}
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
              aria-label="Close image"
            >
              <X size="1.125rem" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

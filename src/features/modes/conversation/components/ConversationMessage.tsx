import { useState, useCallback, useRef, useEffect, memo, useMemo, type CSSProperties } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Message } from "../../../../engine/contracts/types/chat";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { formatTextQuotes } from "../../../../shared/lib/dialogue-quotes";
import { copyToClipboard, normalizeAvatarCropValue } from "../../../../shared/lib/utils";
import { chatKeys } from "../../../catalog/chats/index";
import { resolveMessageMacros } from "../../../../shared/lib/chat-macros";
import { useTranslate } from "../../../../shared/hooks/use-translate";
import { storageApi } from "../../../../shared/api/storage-api";
import {
  hasGenerationReplayDetails,
  messageAttachmentsFromExtra,
  readStoredThinking,
  resolvePromptSnapshotFromExtra,
} from "../../shared/chat-ui/index";
import { ConversationMessageBubble } from "./ConversationMessageBubble";
import { ConversationMessageGrouped } from "./ConversationMessageGrouped";
import { ConversationMessageLine } from "./ConversationMessageLine";
import {
  ConversationMessageSystem,
  EMPTY_MESSAGE_EXTRA,
  HiddenFromAIConversationButton,
  MESSAGE_EDIT_GESTURE_IGNORE_SELECTOR,
  formatGenerationDuration,
  groupConsecutiveSegments,
  parseNamePrefixFormat,
  parseSpeakerTags,
  readGenerationDurationMs,
  resolveConversationAvatar,
  type ConversationCharacterInfo,
  type ConversationMessageExtra,
  type ConversationMessageProps,
  type ConversationMessageRenderContext,
} from "./ConversationMessageShared";

function areStringArraysEqual(prev?: string[], next?: string[]) {
  if (prev === next) return true;
  if (!prev || !next || prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    if (prev[index] !== next[index]) return false;
  }
  return true;
}

function areConversationMessagePropsEqual(prev: ConversationMessageProps, next: ConversationMessageProps) {
  return (
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.isGrouped === next.isGrouped &&
    prev.hideActions === next.hideActions &&
    prev.hideUserAvatar === next.hideUserAvatar &&
    prev.hideTimestamp === next.hideTimestamp &&
    prev.noHoverGroup === next.noHoverGroup &&
    prev.plainUserMessages === next.plainUserMessages &&
    prev.forceShowActions === next.forceShowActions &&
    prev.onDelete === next.onDelete &&
    prev.onRegenerate === next.onRegenerate &&
    prev.onEdit === next.onEdit &&
    prev.onSetActiveSwipe === next.onSetActiveSwipe &&
    prev.onPeekPrompt === next.onPeekPrompt &&
    prev.onToggleHiddenFromAI === next.onToggleHiddenFromAI &&
    prev.onBranch === next.onBranch &&
    prev.isLastAssistantMessage === next.isLastAssistantMessage &&
    prev.characterMap === next.characterMap &&
    prev.personaInfo === next.personaInfo &&
    prev.onEditClick === next.onEditClick &&
    areStringArraysEqual(prev.chatCharacterIds, next.chatCharacterIds) &&
    prev.messageIndex === next.messageIndex &&
    prev.messageOrderIndex === next.messageOrderIndex &&
    prev.multiSelectMode === next.multiSelectMode &&
    prev.isSelected === next.isSelected &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.suppressCardCss === next.suppressCardCss &&
    prev.messageStyle === next.messageStyle &&
    areStringArraysEqual(prev.contentParts, next.contentParts) &&
    prev.visiblePartCount === next.visiblePartCount &&
    prev.bubbleGroupPosition === next.bubbleGroupPosition &&
    prev.originalContent === next.originalContent &&
    prev.typingLabel === next.typingLabel
  );
}

export const ConversationMessage = memo(function ConversationMessage({
  message,
  isStreaming,
  isGrouped,
  hideActions,
  hideUserAvatar,
  hideTimestamp,
  noHoverGroup,
  plainUserMessages,
  forceShowActions,
  onDelete,
  onRegenerate,
  onEdit,
  onSetActiveSwipe,
  onPeekPrompt,
  onToggleHiddenFromAI,
  onBranch,
  characterMap,
  personaInfo,
  onEditClick,
  chatCharacterIds,
  messageIndex,
  messageOrderIndex,
  multiSelectMode,
  isSelected,
  onToggleSelect,
  suppressCardCss,
  messageStyle = "classic",
  contentParts,
  visiblePartCount,
  bubbleGroupPosition = "single",
  originalContent,
  typingLabel,
}: ConversationMessageProps) {
  const [editing, setEditing] = useState(false);
  const cardCssId = editing || suppressCardCss ? undefined : (message.characterId ?? undefined);
  const [editValue, setEditValue] = useState(message.content);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showGenerationReplay, setShowGenerationReplay] = useState(false);
  const [manuallyExpandedHidden, setManuallyExpandedHidden] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<{ url: string; prompt?: string | null } | null>(null);
  const openImageLightbox = useCallback((url: string, prompt?: string | null) => setImageLightbox({ url, prompt }), []);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageTapAtRef = useRef(0);

  const guideGenerations = useUIStore((s) => s.guideGenerations);
  const chatFontSize = useUIStore((s) => s.chatFontSize);
  const quoteFormat = useUIStore((s) => s.quoteFormat);
  const showMessageNumbers = useUIStore((s) => s.showMessageNumbers);
  const collapseHiddenMessages = useUIStore((s) => s.summaryPopoverSettings.collapseHiddenMessages);
  const editMessagesOnDoubleClick = useUIStore((s) => s.editMessagesOnDoubleClick);
  const messageTextStyle = useMemo<CSSProperties>(() => ({ fontSize: `${chatFontSize}px` }), [chatFontSize]);
  const regenerateButtonTitle = guideGenerations ? "Regenerate (guided)" : "Regenerate";
  const regenerateGuidedClass = guideGenerations
    ? "text-[var(--primary)] bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/30 hover:text-[var(--primary)] hover:bg-[var(--primary)]/20"
    : undefined;

  const { translate, translations, translating } = useTranslate();
  const translatedText = translations[message.id];
  const isTranslating = !!translating[message.id];

  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isBubbleStyle = messageStyle === "bubble";
  const isPlainUserMessage = isUser && plainUserMessages === true;

  const extra = useMemo(() => {
    if (!message.extra) return EMPTY_MESSAGE_EXTRA;
    return typeof message.extra === "string" ? (JSON.parse(message.extra) as ConversationMessageExtra) : message.extra;
  }, [message.extra]);
  const attachments = useMemo(() => messageAttachmentsFromExtra(extra), [extra]);
  const generationReplay = hasGenerationReplayDetails(extra.generationReplay) ? extra.generationReplay : null;
  const activePromptSnapshot = useMemo(
    () => resolvePromptSnapshotFromExtra(extra, message.activeSwipeIndex),
    [extra, message.activeSwipeIndex],
  );
  const isHiddenFromAI = extra.hiddenFromAI === true || extra.hiddenFromAi === true;
  const isHiddenExpanded =
    isHiddenFromAI && (!collapseHiddenMessages || manuallyExpandedHidden || editing || isStreaming === true);
  const isHiddenCollapsed = isHiddenFromAI && collapseHiddenMessages && !isHiddenExpanded;
  const shouldHideUserAvatarGraphic = (isUser && hideUserAvatar === true) || (isBubbleStyle && isUser);
  const shouldShowMessageNumber = (showActions || forceShowActions || showMessageNumbers) && messageIndex != null;
  const shouldHideAvatarColumn = shouldHideUserAvatarGraphic && !shouldShowMessageNumber;
  const hiddenFromAIHeader = isHiddenFromAI ? (
    <HiddenFromAIConversationButton
      canCollapse={collapseHiddenMessages}
      isExpanded={isHiddenExpanded}
      onToggle={() => setManuallyExpandedHidden((value) => !value)}
    />
  ) : null;
  const canRegenerate = !isUser || generationReplay !== null;

  useEffect(() => {
    if (!generationReplay) setShowGenerationReplay(false);
  }, [generationReplay]);

  useEffect(() => {
    setManuallyExpandedHidden(false);
  }, [message.id]);

  useEffect(() => {
    if (!isHiddenFromAI || !collapseHiddenMessages) setManuallyExpandedHidden(false);
  }, [collapseHiddenMessages, isHiddenFromAI]);

  const scopedCharacterMap = useMemo(() => {
    if (!characterMap) return null;
    if (!chatCharacterIds) return characterMap;
    const allowedIds = new Set(chatCharacterIds);
    return new Map(Array.from(characterMap).filter(([id]) => allowedIds.has(id)));
  }, [characterMap, chatCharacterIds]);

  const charInfo = message.characterId && scopedCharacterMap ? scopedCharacterMap.get(message.characterId) : null;
  const primaryCharInfo =
    charInfo ??
    (scopedCharacterMap
      ? (Array.from(scopedCharacterMap.values()).find(
          (candidate): candidate is NonNullable<typeof candidate> => !!candidate,
        ) ?? null)
      : null);

  const msgPersona = isUser && !isPlainUserMessage && extra.personaSnapshot ? extra.personaSnapshot : null;
  const avatarUrl = isUser
    ? isPlainUserMessage
      ? null
      : msgPersona
        ? (msgPersona.avatarUrl ?? null)
        : (personaInfo?.avatarUrl ?? null)
    : (charInfo?.avatarUrl ?? null);
  const avatarFilePath = isUser
    ? isPlainUserMessage
      ? null
      : msgPersona
        ? (msgPersona.avatarFilePath ?? null)
        : (personaInfo?.avatarFilePath ?? null)
    : (charInfo?.avatarFilePath ?? null);
  const avatarFilename = isUser
    ? isPlainUserMessage
      ? null
      : msgPersona
        ? (msgPersona.avatarFilename ?? null)
        : (personaInfo?.avatarFilename ?? null)
    : (charInfo?.avatarFilename ?? null);
  const personaAvatarCrop = isUser
    ? isPlainUserMessage
      ? null
      : msgPersona
        ? (normalizeAvatarCropValue(msgPersona.avatarCrop) ?? personaInfo?.avatarCrop ?? null)
        : (personaInfo?.avatarCrop ?? null)
    : null;
  const avatarCrop = isUser ? personaAvatarCrop : (charInfo?.avatarCrop ?? null);
  const displayName = isUser
    ? isPlainUserMessage
      ? "You"
      : (msgPersona?.name ?? personaInfo?.name ?? "You")
    : (primaryCharInfo?.name ?? "Assistant");
  const nameColor = isUser
    ? isPlainUserMessage
      ? undefined
      : (msgPersona?.nameColor ?? personaInfo?.nameColor)
    : charInfo?.nameColor;
  const conversationAvatar = resolveConversationAvatar(isUser ? null : charInfo, avatarUrl);
  const macroContext = useMemo(
    () => ({
      userName: displayName,
      persona: {
        name: displayName,
        description: isPlainUserMessage ? undefined : (msgPersona?.description ?? personaInfo?.description),
        personality: isPlainUserMessage ? undefined : (msgPersona?.personality ?? personaInfo?.personality),
        backstory: isPlainUserMessage ? undefined : (msgPersona?.backstory ?? personaInfo?.backstory),
        appearance: isPlainUserMessage ? undefined : (msgPersona?.appearance ?? personaInfo?.appearance),
        scenario: isPlainUserMessage ? undefined : (msgPersona?.scenario ?? personaInfo?.scenario),
      },
      primaryCharacter: primaryCharInfo ?? { name: displayName },
      characters: scopedCharacterMap
        ? Array.from(scopedCharacterMap.values())
        : displayName
          ? [{ name: displayName }]
          : [],
    }),
    [
      displayName,
      isPlainUserMessage,
      msgPersona?.appearance,
      msgPersona?.backstory,
      msgPersona?.description,
      msgPersona?.name,
      msgPersona?.personality,
      msgPersona?.scenario,
      personaInfo?.appearance,
      personaInfo?.backstory,
      personaInfo?.description,
      personaInfo?.name,
      personaInfo?.personality,
      personaInfo?.scenario,
      primaryCharInfo,
      scopedCharacterMap,
    ],
  );
  const renderedContent = useMemo(
    () => formatTextQuotes(resolveMessageMacros(message.content, macroContext), quoteFormat),
    [macroContext, message.content, quoteFormat],
  );
  const renderedContentParts = useMemo(() => {
    if (!contentParts?.length) return null;
    const count = Math.max(1, Math.min(visiblePartCount ?? contentParts.length, contentParts.length));
    return contentParts
      .slice(0, count)
      .map((part) => formatTextQuotes(resolveMessageMacros(part, macroContext), quoteFormat));
  }, [contentParts, macroContext, quoteFormat, visiblePartCount]);

  const qc = useQueryClient();
  const handleRemoveAttachment = useCallback(
    async (index: number) => {
      const updated = attachments.filter((_, i) => i !== index);
      const msgKey = chatKeys.messages(message.chatId);
      const previous = qc.getQueryData<InfiniteData<Message[]>>(msgKey);
      qc.setQueryData<InfiniteData<Message[]>>(msgKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((m) => {
              if (m.id !== message.id) return m;
              const ex = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
              return { ...m, extra: { ...ex, attachments: updated } } as Message;
            }),
          ),
        };
      });
      try {
        await storageApi.patchChatMessageExtra(message.id, { attachments: updated });
      } catch (error) {
        qc.setQueryData(msgKey, previous);
        toast.error(error instanceof Error ? error.message : "Failed to remove attachment.");
      } finally {
        await qc.invalidateQueries({ queryKey: msgKey });
      }
    },
    [attachments, message.chatId, message.id, qc],
  );

  const charByName = useMemo(() => {
    if (!scopedCharacterMap) return null;
    const map = new Map<string, ConversationCharacterInfo>();
    for (const [id, v] of scopedCharacterMap) {
      if (v) {
        const key = v.name.toLowerCase();
        if (id === message.characterId) map.set(key, v);
        else if (!map.has(key)) map.set(key, v);
      }
    }
    return map;
  }, [scopedCharacterMap, message.characterId]);

  const mentionNames = useMemo(() => {
    if (!scopedCharacterMap) return [] as string[];
    const names: string[] = [];
    for (const [, v] of scopedCharacterMap) {
      if (v?.name) names.push(v.name);
    }
    return names;
  }, [scopedCharacterMap]);

  const groupedSegments = useMemo(() => {
    if (isUser || !renderedContent) return null;
    const knownNames = charByName ? new Set(charByName.keys()) : new Set<string>();
    const speakerSegs = parseSpeakerTags(renderedContent, knownNames);
    if (speakerSegs) return groupConsecutiveSegments(speakerSegs);
    const nameSegs = parseNamePrefixFormat(renderedContent, knownNames);
    if (nameSegs) return groupConsecutiveSegments(nameSegs);
    return null;
  }, [isUser, renderedContent, charByName]);

  const segmentCount = groupedSegments?.length ?? 0;
  const prevContentRef = useRef(renderedContent);
  const initialRenderRef = useRef(true);
  const [visibleSegments, setVisibleSegments] = useState(segmentCount);

  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      setVisibleSegments(segmentCount);
      prevContentRef.current = renderedContent;
      return;
    }
    if (renderedContent !== prevContentRef.current && segmentCount > 1) {
      prevContentRef.current = renderedContent;
      setVisibleSegments(1);
      let count = 1;
      const reveal = () => {
        count++;
        setVisibleSegments(count);
      };
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let i = 1; i < segmentCount; i++) timers.push(setTimeout(reveal, i * 1500));
      return () => timers.forEach(clearTimeout);
    }
    setVisibleSegments(segmentCount);
    prevContentRef.current = renderedContent;
  }, [renderedContent, segmentCount]);

  const thinking = readStoredThinking(extra);
  const generationDurationMs = !isUser ? readGenerationDurationMs(extra.generationInfo) : null;
  const generationDurationLabel = generationDurationMs != null ? formatGenerationDuration(generationDurationMs) : null;
  const generationDurationTitle = generationDurationLabel
    ? `Response generated in ${generationDurationLabel}`
    : "Response generation time";
  const swipeCount = message.swipeCount ?? 0;
  const hasSwipes = swipeCount > 1;
  const editSourceContent = originalContent ?? message.content;
  const hasRenderedContent = renderedContentParts ? renderedContentParts.length > 0 : renderedContent.length > 0;
  const bubbleCornerClass = isUser
    ? bubbleGroupPosition === "single"
      ? "rounded-2xl"
      : bubbleGroupPosition === "first"
        ? "rounded-2xl rounded-br-md"
        : bubbleGroupPosition === "middle"
          ? "rounded-2xl rounded-r-md"
          : "rounded-2xl rounded-tr-md"
    : bubbleGroupPosition === "single"
      ? "rounded-2xl"
      : bubbleGroupPosition === "first"
        ? "rounded-2xl rounded-bl-md"
        : bubbleGroupPosition === "middle"
          ? "rounded-2xl rounded-l-md"
          : "rounded-2xl rounded-tl-md";

  const handleCopy = useCallback(() => {
    copyToClipboard(renderedContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [renderedContent]);

  const startEditing = useCallback(() => {
    setEditError(null);
    setEditSaving(false);
    setEditing(true);
    setEditValue(formatTextQuotes(editSourceContent, quoteFormat));
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
        el.focus();
      }
    });
  }, [editSourceContent, quoteFormat]);

  const startEditingFromMessageGesture = useCallback(
    (event: React.MouseEvent) => {
      if (!editMessagesOnDoubleClick || !onEdit || editing) return false;
      const target = event.target as HTMLElement | null;
      if (target?.closest(MESSAGE_EDIT_GESTURE_IGNORE_SELECTOR)) return false;
      event.preventDefault();
      event.stopPropagation();
      if (onEditClick) onEditClick();
      else startEditing();
      return true;
    },
    [editMessagesOnDoubleClick, editing, onEdit, onEditClick, startEditing],
  );

  const handleMessageDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      startEditingFromMessageGesture(event);
    },
    [startEditingFromMessageGesture],
  );

  const handleMessageClick = useCallback(
    (event: React.MouseEvent) => {
      if (multiSelectMode) {
        onToggleSelect?.({
          messageId: message.id,
          orderIndex: messageOrderIndex ?? 0,
          checked: !isSelected,
          shiftKey: event.shiftKey,
        });
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest(MESSAGE_EDIT_GESTURE_IGNORE_SELECTOR)) return;

      const isCoarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      if (isCoarsePointer) {
        const now = Date.now();
        const isDoubleTap = now - lastMessageTapAtRef.current <= 350;
        lastMessageTapAtRef.current = now;
        if (isDoubleTap && startEditingFromMessageGesture(event)) return;
      }

      setShowActions((v) => !v);
    },
    [isSelected, message.id, messageOrderIndex, multiSelectMode, onToggleSelect, startEditingFromMessageGesture],
  );

  const handleMessageKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(MESSAGE_EDIT_GESTURE_IGNORE_SELECTOR)) return;
      event.preventDefault();
      if (multiSelectMode && onToggleSelect) {
        onToggleSelect({
          messageId: message.id,
          orderIndex: messageOrderIndex ?? 0,
          checked: !isSelected,
          shiftKey: event.shiftKey,
        });
        return;
      }
      setShowActions((v) => !v);
    },
    [isSelected, message.id, messageOrderIndex, multiSelectMode, onToggleSelect],
  );

  useEffect(() => {
    if (!onEdit) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string }>).detail;
      if (detail?.messageId !== message.id) return;
      if (onEditClick) onEditClick();
      else startEditing();
    };
    window.addEventListener("marinara:start-edit-message", handler);
    return () => window.removeEventListener("marinara:start-edit-message", handler);
  }, [message.id, onEdit, onEditClick, startEditing]);

  const editValueRef = useRef(editValue);
  editValueRef.current = editValue;

  const handleSaveEdit = useCallback(async () => {
    if (editSaving) return;
    const val = formatTextQuotes(editValueRef.current.trim(), quoteFormat);
    setEditSaving(true);
    setEditError(null);
    try {
      if (val !== editSourceContent) await onEdit?.(message.id, val);
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not save edit.");
    } finally {
      setEditSaving(false);
    }
  }, [editSaving, editSourceContent, message.id, onEdit, quoteFormat]);

  const handleTranslate = useCallback(
    (content: string) => {
      void translate(message.id, content, message.chatId);
    },
    [message.chatId, message.id, translate],
  );

  const handleStartEditAction = useCallback(() => {
    if (onEditClick) onEditClick();
    else startEditing();
  }, [onEditClick, startEditing]);

  const context: ConversationMessageRenderContext = {
    message,
    cardCssId,
    messageStyle,
    isStreaming,
    isGrouped,
    hideActions,
    hideTimestamp: hideTimestamp === true,
    noHoverGroup,
    forceShowActions,
    multiSelectMode,
    isSelected,
    onToggleSelect:
      multiSelectMode && onToggleSelect
        ? (shiftKey: boolean) =>
            onToggleSelect({
              messageId: message.id,
              orderIndex: messageOrderIndex ?? 0,
              checked: !isSelected,
              shiftKey,
            })
        : undefined,
    messageIndex,
    showActions,
    showMessageNumbers,
    isUser,
    isBubbleStyle,
    isHiddenFromAI,
    isHiddenCollapsed,
    hiddenFromAIHeader,
    canRegenerate,
    editing,
    editRef,
    editValue,
    editSaving,
    editError,
    quoteFormat,
    setEditValue,
    onCancelEdit: () => setEditing(false),
    onSaveEdit: handleSaveEdit,
    messageTextStyle,
    displayName,
    nameColor,
    conversationAvatar,
    avatarUrl,
    avatarFilePath,
    avatarFilename,
    avatarCrop,
    shouldHideUserAvatarGraphic,
    shouldHideAvatarColumn,
    shouldShowMessageNumber,
    renderedContent,
    renderedContentParts,
    hasRenderedContent,
    typingLabel,
    mentionNames,
    groupedSegments,
    visibleSegments,
    charByName,
    attachments,
    translatedText,
    isTranslating,
    hasSwipes,
    swipeCount,
    bubbleCornerClass,
    generationDurationLabel,
    generationDurationTitle,
    regenerateButtonTitle,
    regenerateGuidedClass,
    thinking,
    generationReplay,
    activePromptSnapshot,
    copied,
    handleMessageClick,
    handleMessageDoubleClick,
    handleMessageKeyDown,
    handleCopy,
    onTranslate: handleTranslate,
    onStartEdit: handleStartEditAction,
    onRegenerate,
    onSetActiveSwipe,
    onPeekPrompt,
    onToggleHiddenFromAI,
    onBranch,
    onDelete,
    onShowGenerationReplay: () => setShowGenerationReplay(true),
    onShowThinking: () => setShowThinking(true),
    onImageOpen: openImageLightbox,
    onRemoveAttachment: handleRemoveAttachment,
    onCloseThinking: () => setShowThinking(false),
    onCloseGenerationReplay: () => setShowGenerationReplay(false),
    imageLightbox,
    onCloseImageLightbox: () => setImageLightbox(null),
    showThinking,
    showGenerationReplay,
  };

  if (isSystem) return <ConversationMessageSystem context={context} />;
  if (groupedSegments && !editing && !isUser && !isBubbleStyle) return <ConversationMessageGrouped context={context} />;
  if (isBubbleStyle) return <ConversationMessageBubble context={context} />;
  return <ConversationMessageLine context={context} />;
}, areConversationMessagePropsEqual);

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { CHAT_SCROLL_TO_BOTTOM_EVENT, type ChatScrollToBottomDetail } from "../../../../shared/lib/chat-scroll-events";
import {
  preserveTranscriptScrollAfterPrepend,
  readTranscriptScrollMetrics,
  resolveTranscriptScrollState,
  scheduleTranscriptBottomLock,
  scheduleTranscriptScrollWrite,
  scrollTranscriptToBottom,
  shouldFollowTranscriptBottom,
} from "../../shared/chat-ui";
import type { MessageWithSwipes } from "../../shared/chat-ui/types";

type UseRoleplayTranscriptScrollOptions = {
  activeChatId: string;
  messages: MessageWithSwipes[] | undefined;
  pageCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  isStreaming: boolean;
  totalMessageCount: number;
  messageOffset: number;
  messageIdByOrderIndex: Map<number, string>;
};

export function useRoleplayTranscriptScroll({
  activeChatId,
  messages,
  pageCount,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isStreaming,
  totalMessageCount,
  messageOffset,
  messageIdByOrderIndex,
}: UseRoleplayTranscriptScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const userScrolledAtRef = useRef(0);
  const forcedBottomScrollRef = useRef<{ requestedAt: number; behavior: ScrollBehavior } | null>(null);
  const openedAtBottomChatIdRef = useRef<string | null>(null);
  const followedTailMessageIdRef = useRef<string | undefined>(undefined);
  const streamBuffer = useChatStore((state) => state.streamBuffers.get(activeChatId) ?? state.streamBuffer);
  const thinkingBuffer = useChatStore((state) => state.thinkingBuffers.get(activeChatId) ?? state.thinkingBuffer);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      const metrics = readTranscriptScrollMetrics(element);
      const scrollState = resolveTranscriptScrollState({
        metrics,
        lastScrollTop: lastScrollTopRef.current,
        wasUserScrolledAway: userScrolledAwayRef.current,
        userScrolledAt: userScrolledAtRef.current,
        isStreaming,
      });

      lastScrollTopRef.current = scrollState.lastScrollTop;
      isNearBottomRef.current = scrollState.isNearBottom;
      userScrolledAwayRef.current = scrollState.userScrolledAway;
      userScrolledAtRef.current = scrollState.userScrolledAt;
    };

    const onUserScroll = () => {
      if (isStreaming) {
        userScrolledAwayRef.current = true;
        userScrolledAtRef.current = Date.now();
      }
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onUserScroll, { passive: true });
    element.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onUserScroll);
      element.removeEventListener("touchmove", onUserScroll);
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) userScrolledAwayRef.current = false;
  }, [isStreaming]);

  const scrollToMessagesBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    if (behavior === "smooth") {
      element.scrollTo({ top: element.scrollHeight, behavior });
      lastScrollTopRef.current = element.scrollTop;
      return;
    }
    lastScrollTopRef.current = scrollTranscriptToBottom(element);
  }, []);

  const scheduleScrollToMessagesBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      return scheduleTranscriptBottomLock(() => {
        if (userScrolledAwayRef.current) return false;
        scrollToMessagesBottom(behavior);
        return !userScrolledAwayRef.current;
      });
    },
    [scrollToMessagesBottom],
  );

  useEffect(() => {
    const handleScrollRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChatScrollToBottomDetail>).detail;
      if (!detail?.chatId || detail.chatId !== activeChatId) return;
      const behavior = detail.behavior ?? "auto";
      forcedBottomScrollRef.current = { requestedAt: Date.now(), behavior };
      userScrolledAwayRef.current = false;
      isNearBottomRef.current = true;
      scheduleScrollToMessagesBottom(behavior);
    };

    window.addEventListener(CHAT_SCROLL_TO_BOTTOM_EVENT, handleScrollRequest);
    return () => window.removeEventListener(CHAT_SCROLL_TO_BOTTOM_EVENT, handleScrollRequest);
  }, [activeChatId, scheduleScrollToMessagesBottom]);

  const newestMsgId = messages?.[messages.length - 1]?.id;
  const newestMsgSwipeIndex = messages?.[messages.length - 1]?.activeSwipeIndex;
  const newestMsgRole = messages?.[messages.length - 1]?.role;
  const isOptimistic = newestMsgId?.startsWith("__optimistic_");
  useLayoutEffect(() => {
    if (openedAtBottomChatIdRef.current === activeChatId || !messages?.length || isLoadingMoreRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    return scheduleTranscriptScrollWrite(() => {
      const currentElement = scrollRef.current;
      if (!currentElement || currentElement !== element || isLoadingMoreRef.current) return;
      lastScrollTopRef.current = scrollTranscriptToBottom(currentElement);
      isNearBottomRef.current = true;
      userScrolledAwayRef.current = false;
      openedAtBottomChatIdRef.current = activeChatId;
      followedTailMessageIdRef.current = newestMsgId;
    });
  }, [activeChatId, messages?.length, newestMsgId]);

  useLayoutEffect(() => {
    if (isLoadingMoreRef.current) return;
    const forcedBottomScroll = forcedBottomScrollRef.current;
    const hasFreshForcedBottomScroll = !!forcedBottomScroll && Date.now() - forcedBottomScroll.requestedAt < 5000;
    if (forcedBottomScroll && !hasFreshForcedBottomScroll) {
      forcedBottomScrollRef.current = null;
    }
    const shouldFollowBottom = shouldFollowTranscriptBottom({
      hasFreshForcedBottomScroll,
      isNearBottom: isNearBottomRef.current,
      isOptimisticTail: !!isOptimistic,
      isStreamingWithUserTail: isStreaming && newestMsgRole === "user",
      tailMessageChanged: !!newestMsgId && followedTailMessageIdRef.current !== newestMsgId,
      userScrolledAway: userScrolledAwayRef.current,
    });
    followedTailMessageIdRef.current = newestMsgId;
    if (shouldFollowBottom) {
      const behavior = forcedBottomScroll?.behavior ?? "auto";
      forcedBottomScrollRef.current = null;
      const element = scrollRef.current;
      if (!element) return;
      scrollToMessagesBottom(behavior);
      isNearBottomRef.current = true;
      userScrolledAwayRef.current = false;
      const frame = requestAnimationFrame(() => {
        const currentElement = scrollRef.current;
        if (!currentElement || currentElement !== element || isLoadingMoreRef.current || userScrolledAwayRef.current) {
          return;
        }
        lastScrollTopRef.current = scrollTranscriptToBottom(currentElement);
        isNearBottomRef.current = true;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [
    newestMsgId,
    newestMsgSwipeIndex,
    streamBuffer,
    thinkingBuffer,
    isStreaming,
    isOptimistic,
    newestMsgRole,
    scrollToMessagesBottom,
  ]);

  useLayoutEffect(() => {
    if (isLoadingMoreRef.current && scrollRef.current && !isFetchingNextPage) {
      return scheduleTranscriptScrollWrite(() => {
        const element = scrollRef.current;
        if (!element || !isLoadingMoreRef.current) return;
        preserveTranscriptScrollAfterPrepend(element, prevScrollHeightRef.current);
        isLoadingMoreRef.current = false;
      });
    }
  }, [pageCount, isFetchingNextPage]);

  const handleLoadMore = useCallback(() => {
    if (!scrollRef.current || !hasNextPage || isFetchingNextPage) return;
    prevScrollHeightRef.current = readTranscriptScrollMetrics(scrollRef.current).scrollHeight;
    isLoadingMoreRef.current = true;
    fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const gotoRequest = useChatStore((state) => state.gotoRequest);
  useEffect(() => {
    if (!gotoRequest || gotoRequest.chatId !== activeChatId) return;
    if (!messages) return;

    const targetNumber = gotoRequest.messageNumber;
    if (totalMessageCount > 0 && targetNumber > totalMessageCount) {
      toast.error(`Message #${targetNumber} doesn't exist - this chat has ${totalMessageCount} messages.`);
      useChatStore.getState().clearGotoRequest();
      return;
    }

    const targetIndex = targetNumber - 1;
    if (targetIndex >= messageOffset) {
      const targetId = messageIdByOrderIndex.get(targetIndex);
      if (!targetId) {
        useChatStore.getState().clearGotoRequest();
        return;
      }
      const raf = requestAnimationFrame(() => {
        const element = document.querySelector(`[data-message-id="${CSS.escape(targetId)}"]`);
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          userScrolledAwayRef.current = true;
        }
        useChatStore.getState().clearGotoRequest();
      });
      return () => cancelAnimationFrame(raf);
    }

    if (hasNextPage && !isFetchingNextPage) {
      if (scrollRef.current) {
        prevScrollHeightRef.current = readTranscriptScrollMetrics(scrollRef.current).scrollHeight;
        isLoadingMoreRef.current = true;
      }
      fetchNextPage();
    } else if (!hasNextPage) {
      useChatStore.getState().clearGotoRequest();
    }
  }, [
    gotoRequest,
    activeChatId,
    messages,
    messageOffset,
    messageIdByOrderIndex,
    totalMessageCount,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  return { scrollRef, messagesEndRef, handleLoadMore };
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { useMessageJumpStore, type MessageJumpTarget } from "../../../../../shared/stores/message-jump.store";

/** Older pages to load while looking for the message before giving up (pages are 50-100 messages). */
const MAX_PAGES_TO_LOAD = 60;
/** Messages kept above the target when the transcript window is moved to it. */
const WINDOW_LEAD = 20;
const HIGHLIGHT_MS = 2400;
const SCROLL_ATTEMPTS = 30;

interface JumpableMessage {
  id: string;
}

export interface UseJumpToMessageOptions {
  chatId: string | null;
  messages: readonly JumpableMessage[] | undefined;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  setTranscriptWindowStart: (start: number | null) => void;
  scrollContainerRef: RefObject<HTMLElement | null>;
}

/**
 * Serves a pending "jump to this message" request (from message search) for the open chat: loads older
 * pages until the message is loaded, moves the render window onto it, scrolls it to the middle of the
 * transcript, and highlights it.
 */
export function useJumpToMessage({
  chatId,
  messages,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  setTranscriptWindowStart,
  scrollContainerRef,
}: UseJumpToMessageOptions): void {
  const target = useMessageJumpStore((state) => state.target);
  const clearJump = useMessageJumpStore((state) => state.clearJump);
  const pagesLoadedRef = useRef<{ requestedAt: number; count: number }>({ requestedAt: 0, count: 0 });
  const [readyToScroll, setReadyToScroll] = useState<MessageJumpTarget | null>(null);

  // Find the message, loading older pages as needed.
  useEffect(() => {
    if (!target || !chatId || target.chatId !== chatId || !messages) return;
    if (pagesLoadedRef.current.requestedAt !== target.requestedAt) {
      pagesLoadedRef.current = { requestedAt: target.requestedAt, count: 0 };
    }
    const index = messages.findIndex((message) => message.id === target.messageId);
    if (index >= 0) {
      setTranscriptWindowStart(Math.max(0, index - WINDOW_LEAD));
      setReadyToScroll(target);
      return;
    }
    if (isFetchingNextPage) return;
    if (hasNextPage && pagesLoadedRef.current.count < MAX_PAGES_TO_LOAD) {
      pagesLoadedRef.current.count += 1;
      void fetchNextPage();
      return;
    }
    toast.error("That message is no longer in this chat.");
    clearJump(target.requestedAt);
  }, [chatId, clearJump, fetchNextPage, hasNextPage, isFetchingNextPage, messages, setTranscriptWindowStart, target]);

  // Once the message is in the render window, scroll to it after the transcript has painted (the chat's own
  // open-at-bottom scroll runs first, so keep trying for a few frames).
  useEffect(() => {
    if (!readyToScroll) return;
    let frame = 0;
    let attempts = 0;
    const tryScroll = () => {
      const container = scrollContainerRef.current;
      const element = container?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(readyToScroll.messageId)}"]`,
      );
      if (!element) {
        attempts += 1;
        if (attempts < SCROLL_ATTEMPTS) frame = window.requestAnimationFrame(tryScroll);
        else clearJump(readyToScroll.requestedAt);
        return;
      }
      element.scrollIntoView({ block: "center" });
      element.dataset.messageJumpHighlight = "true";
      // Not cancelled on cleanup: the highlight outlives this effect by design.
      window.setTimeout(() => {
        delete element.dataset.messageJumpHighlight;
      }, HIGHLIGHT_MS);
      clearJump(readyToScroll.requestedAt);
      setReadyToScroll(null);
    };
    // Two frames: one for React to commit the moved window, one for layout.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(tryScroll);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearJump, readyToScroll, scrollContainerRef]);
}

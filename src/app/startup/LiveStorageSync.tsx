import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { readStorageEvents, storageEventsAvailable } from "../../shared/api/storage-events-api";
import { useChatStore } from "../../shared/stores/chat.store";
import { isTranscriptCollection, queryPrefixesForCollections, reconnectDelayMs } from "./live-storage-sync";

/**
 * Keeps this screen in step with other devices on the same hosted runtime: when anything writes a chat,
 * message or library item, the server says which collections changed and this refreshes the matching queries.
 * Message refreshes wait while this tab is streaming a reply, so they never fight the streamed text.
 */
export function LiveStorageSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!storageEventsAvailable()) return;
    const controller = new AbortController();
    const deferred = new Set<string>();
    let failures = 0;
    let connectedBefore = false;

    const refresh = (collections: Iterable<string>) => {
      const prefixes = queryPrefixesForCollections(collections);
      if (prefixes === null) {
        void queryClient.invalidateQueries();
        return;
      }
      for (const queryKey of prefixes) void queryClient.invalidateQueries({ queryKey });
    };

    const handleChanged = (collections: string[]) => {
      const now: string[] = [];
      const streaming = useChatStore.getState().isStreaming;
      for (const collection of collections) {
        if (streaming && isTranscriptCollection(collection)) deferred.add(collection);
        else now.push(collection);
      }
      if (now.length) refresh(now);
    };

    const unsubscribeStreaming = useChatStore.subscribe((state) => {
      if (state.isStreaming || deferred.size === 0) return;
      const pending = [...deferred];
      deferred.clear();
      refresh(pending);
    });

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          await readStorageEvents((message) => {
            if (message.type === "ready") {
              failures = 0;
              // Changes made while disconnected were missed: catch up on the open chat and the chat list.
              if (connectedBefore) refresh(["messages", "chats"]);
              connectedBefore = true;
            } else {
              handleChanged(message.collections);
            }
          }, controller.signal);
          failures += 1;
        } catch (error) {
          if (controller.signal.aborted) return;
          failures += 1;
          console.warn("[live-sync] storage event stream dropped; reconnecting", error);
        }
        await new Promise((resolve) => window.setTimeout(resolve, reconnectDelayMs(failures)));
      }
    })();

    return () => {
      controller.abort();
      unsubscribeStreaming();
    };
  }, [queryClient]);

  return null;
}

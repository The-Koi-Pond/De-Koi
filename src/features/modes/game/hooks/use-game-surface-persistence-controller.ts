import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGameStatePatcher } from "../../../runtime/world-state/index";
import type { GameStatePatchField, GameStatePatchValue } from "../../../runtime/world-state/types";
import { useChatStore } from "../../../../shared/stores/chat.store";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { HudWidget } from "../../../../engine/contracts/types/game";
import { chatKeys } from "../../../catalog/chats/index";
import { gameApi } from "../api/game-api";
import { flushPendingGameMetadataPatches, persistGameMetadataPatch } from "../lib/game-metadata-persistence";
import { patchChatMetadata } from "./use-game";

export type GameJournalEntryInput = Parameters<typeof gameApi.addJournalEntry>[0];

/** Records a journal entry in the background; never rejects. */
export type RecordGameJournalEntry = (entry: GameJournalEntryInput) => Promise<void>;

function reportJournalWriteFailure(error: unknown) {
  console.warn("[game-journal] Failed to record a journal entry.", error);
  // One toast for a burst of failed writes (an offline runtime fails every entry).
  toast.error("Couldn't add that to the game journal.", { id: "game-journal-write-failure" });
}

type UseGameSurfacePersistenceControllerParams = {
  activeChatId: string;
  currentLocation?: string | null;
};

export function useGameSurfacePersistenceController({
  activeChatId,
  currentLocation,
}: UseGameSurfacePersistenceControllerParams) {
  const queryClient = useQueryClient();
  const lastJournaledLocationRef = useRef<string | null>(null);
  const { patchField: patchVisibleGameStateField, flushPatch: flushVisibleGameStatePatch } = useGameStatePatcher(
    activeChatId,
    "game-surface",
  );

  const patchVisibleGameState = useCallback(
    <K extends GameStatePatchField>(field: K, value: GameStatePatchValue[K]) => {
      patchVisibleGameStateField(field, value);
      return flushVisibleGameStatePatch();
    },
    [flushVisibleGameStatePatch, patchVisibleGameStateField],
  );

  const publishSessionChat = useCallback(
    (sessionChat: Chat | null | undefined) => {
      if (!sessionChat?.id) return;
      queryClient.setQueryData(chatKeys.detail(sessionChat.id), sessionChat);
      if (useChatStore.getState().activeChatId === sessionChat.id) {
        useChatStore.getState().setActiveChat(sessionChat);
      }
    },
    [queryClient],
  );

  // Never rejects, including when publishing the saved chat throws, so callers that
  // record several entries in a row keep going after one failure.
  const recordJournalEntry = useCallback<RecordGameJournalEntry>(
    async (entry) => {
      try {
        const res = await gameApi.addJournalEntry(entry);
        publishSessionChat(res.sessionChat);
      } catch (error) {
        reportJournalWriteFailure(error);
      }
    },
    [publishSessionChat],
  );

  const persistMetadata = useCallback(
    (chatId: string, patch: Record<string, unknown>) =>
      persistGameMetadataPatch(chatId, patch, { onPersisted: publishSessionChat }),
    [publishSessionChat],
  );

  useEffect(() => {
    void flushPendingGameMetadataPatches(activeChatId, { onPersisted: publishSessionChat }).catch(() => {
      /* failure is retained and reported by the persistence helper */
    });
  }, [activeChatId, publishSessionChat]);

  useEffect(() => {
    if (!currentLocation || currentLocation === lastJournaledLocationRef.current) return;
    lastJournaledLocationRef.current = currentLocation;
    void recordJournalEntry({
      chatId: activeChatId,
      type: "location",
      data: { location: currentLocation, description: `The party is at ${currentLocation}.` },
    });
  }, [activeChatId, currentLocation, recordJournalEntry]);

  const syncHudWidgetsToChatCache = useCallback(
    (widgets: HudWidget[]) => {
      const detailKey = chatKeys.detail(activeChatId);
      const patchedChat = patchChatMetadata(queryClient.getQueryData<Chat>(detailKey), { gameWidgetState: widgets });
      if (patchedChat) {
        queryClient.setQueryData(detailKey, patchedChat);
      }

      const chatStore = useChatStore.getState();
      if (chatStore.activeChatId === activeChatId) {
        const patchedActiveChat = patchChatMetadata(chatStore.activeChat as Chat | null, { gameWidgetState: widgets });
        if (patchedActiveChat) {
          chatStore.setActiveChat(patchedActiveChat);
        }
      }
    },
    [activeChatId, queryClient],
  );

  return {
    patchVisibleGameState,
    persistMetadata,
    publishSessionChat,
    recordJournalEntry,
    syncHudWidgetsToChatCache,
  };
}

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  checkConversationAutonomous,
  checkConversationCharacterExchange,
  clearGenerationInProgress,
  getConversationBusyDelay,
  markGenerationInProgress,
  recordAssistantActivity as recordAssistantActivityState,
  recordAutonomousClientPresence,
  recordUserActivity as recordUserActivityState,
} from "../../../../../engine/modes/chat/autonomous/autonomous.service";
import { generateConversationSchedules } from "../../../../../engine/modes/chat/schedules/schedule.service";
import { maybeRefreshConversationStatusMessages } from "../../../../../engine/modes/chat/status/status-message.service";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { invalidateCharacterCollectionQueries } from "../../../../catalog/characters/index";
import { chatKeys } from "../../../../catalog/chats/index";
import { useGenerate } from "../../../../runtime/generation/index";

export function useAutonomousMessaging(
  chatId: string | null,
  autonomousEnabled: boolean,
  exchangesEnabled: boolean,
  conversationStatusMessagesEnabled: boolean,
  onAutonomousMessage?: (characterId: string) => void,
) {
  const { generate } = useGenerate();
  const qc = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyGenerationRef = useRef<{ chatId: string; startedAt: number; epoch: number } | null>(null);
  const generatingChatEpochsRef = useRef<Map<string, number>>(new Map());
  const pollEpochRef = useRef(0);
  const onAutonomousMessageRef = useRef(onAutonomousMessage);
  onAutonomousMessageRef.current = onAutonomousMessage;

  const schedulePoll = useCallback((run: () => Promise<void>, epoch: number, delayMs = 30_000) => {
    if (pollEpochRef.current !== epoch) return;
    clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => {
      if (pollEpochRef.current !== epoch) return;
      void run();
    }, delayMs);
  }, []);

  const recordAssistantActivity = useCallback(
    (characterId?: string) => {
      if (!chatId) return;
      recordAssistantActivityState(chatId, characterId);
    },
    [chatId],
  );

  const ensureSchedules = useCallback(
    async (characterIds?: string[]) => {
      if (!chatId) return;
      await generateConversationSchedules(
        { storage: storageApi, llm: llmApi },
        {
          chatId,
          characterIds,
          scheduleGenerationPreferences: useUIStore.getState().scheduleGenerationPreferences,
        },
      );
      invalidateCharacterCollectionQueries(qc);
      await qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
    },
    [chatId, qc],
  );

  const recordUserActivity = useCallback(() => {
    if (!chatId) return;
    recordUserActivityState(chatId, {
      preserveGenerationInProgress: useChatStore.getState().abortControllers.has(chatId),
    });
  }, [chatId]);

  const triggerAutonomousGeneration = useCallback(
    async (characterId: string, poll: () => Promise<void>, epoch: number, lockedAt?: number) => {
      if (!chatId || pollEpochRef.current !== epoch) return;
      generatingChatEpochsRef.current.set(chatId, epoch);
      const startedAt = lockedAt ?? markGenerationInProgress(chatId);
      let produced = false;
      let shouldSchedulePoll = true;
      try {
        produced = await generate({
          chatId,
          connectionId: null,
          forCharacterId: characterId,
        });
        if (pollEpochRef.current !== epoch) return;
        if (produced) {
          recordAssistantActivityState(chatId, characterId);
          await qc.invalidateQueries({ queryKey: chatKeys.list() });
          await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
          onAutonomousMessageRef.current?.(characterId);
        }
      } catch {
        // Autonomous generation failures are surfaced through provider/runtime state; keep polling alive.
      } finally {
        clearGenerationInProgress(chatId, startedAt);
        if (generatingChatEpochsRef.current.get(chatId) === epoch) {
          generatingChatEpochsRef.current.delete(chatId);
        }
      }

      if (pollEpochRef.current !== epoch) return;

      if (produced && exchangesEnabled) {
        try {
          const exchange = await checkConversationCharacterExchange(storageApi, {
            chatId,
            lastSpeakerCharId: characterId,
          });
          const nextCharacterId = exchange.characterIds[0];
          if (exchange.shouldTrigger && nextCharacterId) {
            shouldSchedulePoll = false;
            clearTimeout(busyTimerRef.current);
            busyTimerRef.current = setTimeout(
              () => {
                if (!useChatStore.getState().abortControllers.has(chatId)) {
                  void triggerAutonomousGeneration(nextCharacterId, poll, epoch);
                } else {
                  schedulePoll(poll, epoch);
                }
              },
              2_000 + Math.random() * 3_000,
            );
          }
        } catch {
          // Exchange probing is opportunistic; a failure should not stop normal polling.
        }
      }

      if (!produced) {
        recordAssistantActivityState(chatId);
      }
      if (shouldSchedulePoll) schedulePoll(poll, epoch);
    },
    [chatId, exchangesEnabled, generate, qc, schedulePoll],
  );

  useEffect(() => {
    if (!chatId || (!autonomousEnabled && !conversationStatusMessagesEnabled)) return;
    const epoch = ++pollEpochRef.current;

    const poll = async () => {
      if (pollEpochRef.current !== epoch) return;
      if (generatingChatEpochsRef.current.has(chatId) || useChatStore.getState().abortControllers.has(chatId)) {
        schedulePoll(poll, epoch);
        return;
      }

      if (conversationStatusMessagesEnabled) {
        try {
          const statusMessages = await maybeRefreshConversationStatusMessages(
            { storage: storageApi, llm: llmApi },
            { chatId },
          );
          if (statusMessages.refreshed.length > 0) {
            invalidateCharacterCollectionQueries(qc);
          }
        } catch (error) {
          console.error("Failed to refresh conversation status blurbs.", error);
        }
        if (pollEpochRef.current !== epoch) return;
      }

      if (!autonomousEnabled) {
        schedulePoll(poll, epoch);
        return;
      }

      const userStatus = useUIStore.getState().userStatus;
      recordAutonomousClientPresence(chatId, userStatus);
      if (userStatus === "dnd") {
        schedulePoll(poll, epoch);
        return;
      }

      let startedAt: number | null = null;
      try {
        const result = await checkConversationAutonomous(storageApi, { chatId, userStatus });
        if (pollEpochRef.current !== epoch) return;
        invalidateCharacterCollectionQueries(qc);
        const characterId = result.characterIds[0];
        if (!result.shouldTrigger || !characterId) {
          schedulePoll(poll, epoch);
          return;
        }
        startedAt = markGenerationInProgress(chatId);

        const delay = await getConversationBusyDelay(storageApi, { chatId, characterId });
        if (pollEpochRef.current !== epoch) {
          clearGenerationInProgress(chatId, startedAt);
          return;
        }
        if (delay.delayMs > 0) {
          const lockedAt = startedAt;
          const priorBusyGeneration = busyGenerationRef.current;
          if (priorBusyGeneration != null) {
            clearGenerationInProgress(priorBusyGeneration.chatId, priorBusyGeneration.startedAt);
          }
          clearTimeout(busyTimerRef.current);
          busyGenerationRef.current = { chatId, startedAt: lockedAt, epoch };
          busyTimerRef.current = setTimeout(() => {
            if (pollEpochRef.current !== epoch) return;
            if (busyGenerationRef.current?.epoch === epoch) busyGenerationRef.current = null;
            if (generatingChatEpochsRef.current.has(chatId) || useChatStore.getState().abortControllers.has(chatId)) {
              clearGenerationInProgress(chatId, lockedAt);
              schedulePoll(poll, epoch);
              return;
            }
            void triggerAutonomousGeneration(characterId, poll, epoch, lockedAt);
          }, delay.delayMs);
          return;
        }

        await triggerAutonomousGeneration(characterId, poll, epoch, startedAt);
      } catch {
        if (startedAt != null) {
          clearGenerationInProgress(chatId, startedAt);
        }
        const busyGeneration = busyGenerationRef.current;
        if (busyGeneration?.epoch === epoch) {
          clearGenerationInProgress(busyGeneration.chatId, busyGeneration.startedAt);
          busyGenerationRef.current = null;
        }
        schedulePoll(poll, epoch);
      }
    };

    schedulePoll(poll, epoch, 10_000);
    return () => {
      if (pollEpochRef.current === epoch) pollEpochRef.current += 1;
      clearTimeout(pollTimerRef.current);
      clearTimeout(busyTimerRef.current);
      const busyGeneration = busyGenerationRef.current;
      if (busyGeneration?.epoch === epoch) {
        clearGenerationInProgress(busyGeneration.chatId, busyGeneration.startedAt);
        busyGenerationRef.current = null;
      }
    };
  }, [autonomousEnabled, chatId, conversationStatusMessagesEnabled, exchangesEnabled, qc, schedulePoll, triggerAutonomousGeneration]);

  return {
    recordUserActivity,
    recordAssistantActivity,
    ensureSchedules,
  };
}

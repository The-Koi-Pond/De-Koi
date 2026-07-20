// ──────────────────────────────────────────────
// Hook: Background Autonomous Polling
// ──────────────────────────────────────────────
// Polls for autonomous messages on inactive conversation chats.
// Lives at the AppShell level so it persists across chat switches.
// The active chat's autonomous messaging is handled by ConversationView.

import { useEffect, useMemo, useRef } from "react";
import type { Chat } from "../../../../../engine/contracts/types/chat";
import type { AvatarCropValue } from "../../../../../shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  checkConversationAutonomous,
  clearGenerationInProgress,
  getConversationBusyDelay,
  markGenerationInProgress,
  recordAssistantActivity,
} from "../../../../../engine/modes/chat/autonomous/autonomous.service";
import { chatCommandApi } from "../../../../../shared/api/chat-command-api";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { integrationGateway } from "../../../../../shared/api/integration-gateway";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { showLocalChatNotification } from "../../../../../shared/lib/local-notifications";
import { playNotificationPing } from "../../../../../shared/lib/notification-sound";
import { chatKeys, useChatSummaries } from "../../../../catalog/chats/index";
import { invalidateCharacterCollectionQueries } from "../../../../catalog/characters/index";

interface RawCharacter {
  id: string;
  data?: { name?: string; extensions?: { avatarCrop?: AvatarCropValue | null } };
  avatarPath?: string | null;
}

/**
 * Background polling for autonomous messages on inactive conversation chats.
 * Eligibility comes from the catalog-owned summary cache so an idle host can
 * remain completely quiescent until a metadata mutation makes work eligible.
 */
export function useBackgroundAutonomousPolling() {
  const qc = useQueryClient();
  const { data: chatSummaries } = useChatSummaries();
  const activeChatId = useChatStore((state) => state.activeChatId);
  const eligibleChatIds = useMemo(
    () =>
      (chatSummaries ?? [])
        .filter(
          (chat) =>
            chat.id !== activeChatId && chat.mode === "conversation" && chat.metadata.autonomousMessages === true,
        )
        .map((chat) => chat.id),
    [activeChatId, chatSummaries],
  );
  const eligibleChatIdsKey = JSON.stringify(eligibleChatIds);
  const generatingForRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const delayTimers = new Map<ReturnType<typeof setTimeout>, { chatId: string; startedAt: number }>();
    const backgroundChats = (JSON.parse(eligibleChatIdsKey) as string[]).map((id) => ({ id }));

    const poll = async () => {
      if (cancelled) return;

      // Don't trigger autonomous messages when user is DND
      if (useUIStore.getState().userStatus === "dnd") {
        schedulePoll();
        return;
      }

      // Check each background chat (sequentially to avoid hammering the server)
      for (const chat of backgroundChats) {
        if (generatingForRef.current.has(chat.id)) continue;
        // Don't proceed if this chat already has an in-flight generation
        if (useChatStore.getState().abortControllers.has(chat.id)) continue;

        try {
          const result = await checkConversationAutonomous(storageApi, {
            chatId: chat.id,
            userStatus: useUIStore.getState().userStatus,
          });
          if (cancelled) return;

          if (result.shouldTrigger && result.characterIds.length > 0) {
            const characterId = result.characterIds[0]!;
            const startedAt = markGenerationInProgress(chat.id);

            // Check busy delay
            const delay = await getConversationBusyDelay(storageApi, { chatId: chat.id, characterId });
            if (cancelled) {
              clearGenerationInProgress(chat.id, startedAt);
              return;
            }

            // Generate in background (after optional delay)
            generatingForRef.current.add(chat.id);
            const doGenerate = async () => {
              let receivedTokens = false;
              let shouldClearAutonomousFlag = true;
              try {
                // Re-check guard — a generation may have started for this chat
                // during the busy delay.
                if (useChatStore.getState().abortControllers.has(chat.id)) {
                  shouldClearAutonomousFlag = false;
                  generatingForRef.current.delete(chat.id);
                  clearGenerationInProgress(chat.id, startedAt);
                  return;
                }

                // Drain the TS generation engine; tokens aren't displayed for background chats.
                const { startGeneration } = await import("../../../../../engine/generation/start-generation");
                for await (const _event of startGeneration(
                  { storage: storageApi, llm: llmApi, integrations: integrationGateway },
                  {
                    chatId: chat.id,
                    connectionId: null,
                    forCharacterId: characterId,
                    streaming: useUIStore.getState().enableStreaming,
                    hideAutomatedSummarySourceMessages:
                      useUIStore.getState().summaryPopoverSettings.hideSummarizedMessages,
                  },
                )) {
                  if ((_event as { type: string }).type === "token") receivedTokens = true;
                }

                // Only notify if the generation actually produced a message
                if (!receivedTokens) return;

                // Reset + refetch messages so the cache has fresh data when the
                // user navigates to this chat. Without this, TanStack Query
                // would show stale cached data (missing the new message) until
                // the background refetch completes — making it look like the
                // message isn't there even though it was saved.
                qc.resetQueries({ queryKey: chatKeys.messages(chat.id) });
                invalidateCharacterCollectionQueries(qc);
                void chatCommandApi
                  .markAutonomousUnread<Chat>(chat.id, { characterId })
                  .then((updatedChat) => {
                    qc.setQueryData(chatKeys.detail(chat.id), updatedChat);
                    qc.invalidateQueries({ queryKey: chatKeys.list() });
                  })
                  .catch(() => {
                    /* persistence is best-effort; keep the local notification */
                  });

                // Resolve character name for the notification
                let charName = "Someone";
                let charAvatar: string | null = null;
                let charAvatarCrop: AvatarCropValue | null = null;
                try {
                  // Find the triggering character's name
                  const charRow = await storageApi.get<RawCharacter>("characters", characterId);
                  if (charRow) {
                    const data = charRow.data;
                    if (data?.name) charName = data.name;
                    charAvatarCrop = data?.extensions?.avatarCrop ?? null;
                    charAvatar = charRow.avatarPath ?? null;
                  }
                } catch {
                  /* use fallback name */
                }

                // Play notification sound
                const uiState = useUIStore.getState();
                if (uiState.convoNotificationSound) {
                  playNotificationPing(uiState.notificationSound, uiState.customNotificationSound);
                }

                // Increment unread badge
                useChatStore.getState().incrementUnread(chat.id);

                // Add floating avatar notification bubble
                useChatStore.getState().addNotification(chat.id, charName, charAvatar, charAvatarCrop);

                void showLocalChatNotification({
                  enabled: useUIStore.getState().conversationBrowserNotifications,
                  chatId: chat.id,
                  characterName: charName,
                  tag: `marinara-conversation-${chat.id}`,
                });

                // Show a global toast so the user knows even from a different chat
                toast(`${charName} sent you a message`, { icon: "💬" });
              } catch {
                // generation failed — non-critical
              } finally {
                if (!receivedTokens && shouldClearAutonomousFlag) {
                  recordAssistantActivity(chat.id);
                }
                clearGenerationInProgress(chat.id, startedAt);
                generatingForRef.current.delete(chat.id);
              }
            };

            if (delay.delayMs > 0) {
              const timerId = setTimeout(() => {
                delayTimers.delete(timerId);
                if (cancelled) {
                  generatingForRef.current.delete(chat.id);
                  clearGenerationInProgress(chat.id, startedAt);
                  return;
                }
                doGenerate();
              }, delay.delayMs);
              delayTimers.set(timerId, { chatId: chat.id, startedAt });
            } else {
              doGenerate();
            }
          }
        } catch {
          // Check failed — skip this chat, try next
        }
      }

      schedulePoll();
    };

    const schedulePoll = () => {
      if (cancelled) return;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, 30_000);
    };

    // Start polling after an initial delay (staggered from active autonomous polling at 10s)
    if (backgroundChats.length > 0) pollTimer = setTimeout(poll, 20_000);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      for (const [timer, lock] of delayTimers) {
        clearTimeout(timer);
        clearGenerationInProgress(lock.chatId, lock.startedAt);
        generatingForRef.current.delete(lock.chatId);
      }
      delayTimers.clear();
    };
  }, [eligibleChatIdsKey, qc]);
}

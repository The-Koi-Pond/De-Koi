import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { chatKeys, useBranchChat } from "../../../../catalog/chats/index";
import { useGenerate } from "../../../../runtime/generation/index";
import { chatCommandApi } from "../../../../../shared/api/chat-command-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import type { MessageWithSwipes } from "../types";

type UserVersion = { messageId: string; index: number };

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return readRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function answersUserVersion(extra: unknown): UserVersion | null {
  const marker = readRecord(readRecord(extra).answersUserVersion);
  const messageId = typeof marker.messageId === "string" ? marker.messageId : "";
  const index = typeof marker.index === "number" ? marker.index : -1;
  return messageId && index >= 0 ? { messageId, index } : null;
}

function activeIndex(message: MessageWithSwipes): number {
  const index = Number(message.activeSwipeIndex ?? 0);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/** The reply right after a user message, when that is the only reply before the next user message. */
function singleReplyAfter(messages: MessageWithSwipes[], userIndex: number): MessageWithSwipes | null {
  const next = messages[userIndex + 1];
  if (!next || next.role !== "assistant") return null;
  const following = messages[userIndex + 2];
  return following && following.role === "assistant" ? null : next;
}

/**
 * Conversation "edit and resend".
 * - Your latest message: the edit becomes a new version (swipe) of it, the old text stays as the previous version,
 *   and the reply is regenerated as a new version too. Each reply version records which of your versions it answers
 *   (engine: extra.answersUserVersion), so `pairReplyWithUserVersion` can flip the reply when you flip your message.
 * - An older message (or one with several replies after it): the chat branches at that message, the copy gets the
 *   edited text, and the branch gets a fresh reply. Your later messages stay untouched in the original chat.
 */
export function useEditAndResend({
  activeChatId,
  messages,
  setActiveSwipe,
}: {
  activeChatId: string;
  messages: MessageWithSwipes[] | undefined;
  setActiveSwipe: (messageId: string, index: number) => void;
}) {
  const queryClient = useQueryClient();
  const { generate } = useGenerate();
  // Read the latest transcript without re-creating the callbacks (they go to every message row).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const branchChat = useBranchChat();

  const handleEditAndResend = useCallback(
    async (messageId: string, content: string) => {
      const list = messagesRef.current ?? [];
      const userIndex = list.findIndex((message) => message.id === messageId);
      const userMessage = list[userIndex];
      if (!activeChatId || !userMessage || userMessage.role !== "user") return;
      const chatState = useChatStore.getState();
      if (chatState.isStreaming && chatState.streamingChatId === activeChatId) {
        toast.error("Wait for the current reply to finish.");
        return;
      }
      const laterUserMessage = list.slice(userIndex + 1).some((message) => message.role === "user");
      const reply = singleReplyAfter(list, userIndex);
      const repliesAfter = list.slice(userIndex + 1).filter((message) => message.role === "assistant").length;

      if (!laterUserMessage && repliesAfter <= 1) {
        // Tag the current reply with the version it answered (replies saved before this feature have no tag).
        if (reply && !answersUserVersion(reply.extra)) {
          await storageApi.patchChatMessageExtra(reply.id, {
            answersUserVersion: { messageId, index: activeIndex(userMessage) },
          });
        }
        await storageApi.addChatMessageSwipe(activeChatId, messageId, content, { activate: true });
        await queryClient.invalidateQueries({ queryKey: chatKeys.messages(activeChatId) });
        await generate(
          reply
            ? {
                chatId: activeChatId,
                connectionId: null,
                regenerateMessageId: reply.id,
                forCharacterId: reply.characterId ?? null,
              }
            : { chatId: activeChatId, connectionId: null },
        );
        return;
      }

      const branch = await branchChat.mutateAsync({ chatId: activeChatId, upToMessageId: messageId });
      if (!branch?.id) throw new Error("Could not create the branch.");
      const branchMessages = await storageApi.listChatMessages<MessageWithSwipes>(branch.id);
      const copy = [...branchMessages]
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .filter((message) => message.role === "user")
        .at(-1);
      if (!copy) throw new Error("The branch is missing your message.");
      await storageApi.updateChatMessage(copy.id, { content });
      useChatStore.getState().setActiveChatId(branch.id);
      toast("Opened as a new branch, so your later messages stay in the original chat.");
      await generate({ chatId: branch.id, connectionId: null });
    },
    [activeChatId, branchChat, generate, queryClient],
  );

  /** After you switch a version of your message, show the reply version that answered it (if there is one). */
  const pairReplyWithUserVersion = useCallback(
    async (messageId: string, index: number) => {
      const list = messagesRef.current ?? [];
      const userIndex = list.findIndex((message) => message.id === messageId);
      if (userIndex < 0 || list[userIndex]!.role !== "user") return;
      const reply = singleReplyAfter(list, userIndex);
      if (!reply) return;
      const swipes = await chatCommandApi.swipes<Array<{ extra?: unknown }>>(activeChatId, reply.id);
      let match = -1;
      (Array.isArray(swipes) ? swipes : []).forEach((swipe, swipeIndex) => {
        const marker = answersUserVersion(swipe.extra);
        if (marker?.messageId === messageId && marker.index === index) match = swipeIndex;
      });
      if (match >= 0 && match !== activeIndex(reply)) setActiveSwipe(reply.id, match);
    },
    [activeChatId, setActiveSwipe],
  );

  return { handleEditAndResend, pairReplyWithUserVersion };
}

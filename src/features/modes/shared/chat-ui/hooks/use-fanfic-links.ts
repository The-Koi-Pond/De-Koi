import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Chat } from "../../../../../engine/contracts/types/chat";
import {
  linkFanficChat,
  listFanficLinkedChats,
  loadLinkedFic,
  readFanficLink,
  readFanficLinkedChatIds,
  unlinkFanficChat,
} from "../../../../../engine/modes/fanfic/links";
import type { JsonRecord } from "../../../../../engine/generation/runtime-records";
import { storageApi } from "../../../../../shared/api/storage-api";
import { useMutation } from "../../../../../shared/hooks/use-mutation";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { chatKeys } from "../../../../catalog/chats/index";

const linkKeys = {
  ficChats: (ficChatId: string, ids: string) => [...chatKeys.all, "fanfic-links", "fic", ficChatId, ids] as const,
  chatFic: (chatId: string, ficChatId: string) => [...chatKeys.all, "fanfic-links", "chat", chatId, ficChatId] as const,
};

/** The roleplays and chats a fic is linked to (only links both sides still hold). */
export function useFanficLinkedChats(fic: Chat | null | undefined) {
  const ids = fic ? readFanficLinkedChatIds(fic.metadata).join(",") : "";
  return useQuery({
    queryKey: linkKeys.ficChats(fic?.id ?? "", ids),
    queryFn: async () => (await listFanficLinkedChats(storageApi, fic as unknown as JsonRecord)) as unknown as Chat[],
    enabled: !!fic && ids.length > 0,
    staleTime: 30_000,
  });
}

/** The fic a roleplay or chat is linked to, while the fic still lists it. */
export function useLinkedFic(chat: Chat | null | undefined) {
  const ficChatId = chat ? (readFanficLink(chat.metadata) ?? "") : "";
  return useQuery({
    queryKey: linkKeys.chatFic(chat?.id ?? "", ficChatId),
    queryFn: async () => ((await loadLinkedFic(storageApi, chat as unknown as JsonRecord)) as unknown as Chat) ?? null,
    enabled: !!chat && !!ficChatId,
    staleTime: 30_000,
  });
}

/** Links and unlinks a fic and a chat; both chats are read again afterwards. */
export function useFanficLinkActions() {
  const queryClient = useQueryClient();
  const refresh = (input: { ficChatId: string; chatId: string }) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: chatKeys.detail(input.ficChatId) }),
      queryClient.invalidateQueries({ queryKey: chatKeys.detail(input.chatId) }),
      queryClient.invalidateQueries({ queryKey: [...chatKeys.all, "fanfic-links"] }),
    ]);
  const link = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (input: { ficChatId: string; chatId: string }) => linkFanficChat(storageApi, input),
    onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't link them. Try again." })),
    onSettled: (_data, _error, input) => refresh(input),
  });
  const unlink = useMutation({
    meta: { handlesOwnErrors: true },
    mutationFn: (input: { ficChatId: string; chatId: string }) => unlinkFanficChat(storageApi, input),
    onError: (error) => toast.error(toUserMessage(error, { fallback: "Couldn't unlink them. Try again." })),
    onSettled: (_data, _error, input) => refresh(input),
  });
  return { link, unlink };
}

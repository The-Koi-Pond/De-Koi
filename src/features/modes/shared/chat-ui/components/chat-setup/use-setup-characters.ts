import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Message } from "../../../../../../engine/contracts/types/chat";
import { storageApi } from "../../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { useCharacterSummariesByIds } from "../../../../../catalog/characters/index";
import {
  chatKeys,
  useChatMessages,
  useCreateMessage,
  useDeleteMessage,
  useUpdateChat,
} from "../../../../../catalog/chats/index";
import { namedSetupCharacter, readCardGreeting, toSetupCharacter, type SetupCharacter } from "./setup-characters";
import { setupChatName, type SetupChatFields } from "./setup-chat";

/**
 * The draft chat's characters while setup is open. Every add and remove saves `characterIds` at once and, while the
 * chat still names itself, renames it after the picked characters.
 *
 * With greetings on (every layout but Conversation), adding a character also adds its card's greeting as an
 * assistant message with the alternate greetings as inactive swipes, and removing the character again deletes that
 * greeting while the user hasn't written anything in the chat (decision 1).
 */
export function useSetupCharacters({
  chat,
  addGreetings,
  shouldRename,
}: {
  chat: SetupChatFields;
  addGreetings: boolean;
  /** Read on every change, so a name typed meanwhile stops the renaming. */
  shouldRename: () => boolean;
}) {
  const queryClient = useQueryClient();
  const updateChat = useUpdateChat();
  const createMessage = useCreateMessage(chat.id);
  const deleteMessage = useDeleteMessage(chat.id);
  const messages = useChatMessages(chat.id, undefined, addGreetings);

  const savedIdsKey = chat.characterIds.join("\0");
  const [selectedIds, setSelectedIds] = useState<string[]>(chat.characterIds);
  const selectedIdsRef = useRef(selectedIds);
  // Characters picked or created during setup, so their names are known before the library query catches up.
  const knownRef = useRef(new Map<string, SetupCharacter>());
  // The greeting setup added for each character, by message id (null when the card has none).
  const greetingsRef = useRef(new Map<string, Promise<string | null>>());
  const messagesRef = useRef(messages.data);
  messagesRef.current = messages.data;

  useEffect(() => {
    const saved = savedIdsKey ? savedIdsKey.split("\0") : [];
    selectedIdsRef.current = saved;
    setSelectedIds(saved);
  }, [savedIdsKey]);

  const summaries = useCharacterSummariesByIds(selectedIds);
  const selected = useMemo(() => {
    const byId = new Map(summaries.data.map((summary) => [summary.id, toSetupCharacter(summary)]));
    return selectedIds.flatMap((id) => {
      const character = byId.get(id) ?? knownRef.current.get(id);
      return character ? [character] : [];
    });
  }, [selectedIds, summaries.data]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const nameUpdate = useCallback(
    (ids: readonly string[]) => {
      if (!shouldRename()) return {};
      const names = ids.map(
        (id) => knownRef.current.get(id)?.name ?? selectedRef.current.find((character) => character.id === id)?.name,
      );
      // A name not loaded yet would leave a character out of the title; the chat keeps its name until it is.
      if (names.some((name) => !name)) return {};
      return { name: setupChatName(chat.isConversation, names as string[]) };
    },
    [chat.isConversation, shouldRename],
  );

  const setSelection = (ids: string[]) => {
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
  };

  const addGreeting = async (characterId: string): Promise<string | null> => {
    let messageId: string | null = null;
    try {
      const greeting = readCardGreeting(await storageApi.get<unknown>("characters", characterId));
      if (!greeting) return null;
      const message = await createMessage.mutateAsync({
        role: "assistant",
        content: greeting.firstMessage,
        characterId,
      });
      messageId = (message as { id?: string } | undefined)?.id ?? null;
      if (messageId) {
        for (const alternate of greeting.alternates) {
          await storageApi.addChatMessageSwipe(chat.id, messageId, alternate, { activate: false });
        }
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
    } catch {
      toast.error("Couldn't add the character's greeting. Try again.");
    }
    return messageId;
  };

  const removeGreeting = async (pending: Promise<string | null>) => {
    const messageId = await pending;
    if (!messageId) return;
    const loaded = messagesRef.current?.pages.flat() as Message[] | undefined;
    // Only while the chat is still untouched: once the user has written, the greeting is part of their story.
    if (!loaded || loaded.some((message) => message.role === "user")) return;
    try {
      await deleteMessage.mutateAsync(messageId);
    } catch (error) {
      toast.error(toUserMessage(error, { fallback: "Couldn't remove the character's greeting. Try again." }));
    }
  };

  const add = async (character: SetupCharacter) => {
    const current = selectedIdsRef.current;
    if (current.includes(character.id)) return;
    knownRef.current.set(character.id, character);
    const next = [...current, character.id];
    setSelection(next);
    try {
      await updateChat.mutateAsync({ id: chat.id, characterIds: next, ...nameUpdate(next) });
    } catch (error) {
      setSelection(selectedIdsRef.current.filter((id) => id !== character.id));
      toast.error(toUserMessage(error, { fallback: "Couldn't add the character. Try again." }));
      return;
    }
    if (addGreetings) greetingsRef.current.set(character.id, addGreeting(character.id));
  };

  const addNamed = (id: string, name: string) => add(namedSetupCharacter(id, name));

  const remove = (characterId: string) => {
    const next = selectedIdsRef.current.filter((id) => id !== characterId);
    setSelection(next);
    updateChat.mutate({ id: chat.id, characterIds: next, ...nameUpdate(next) });
    const greeting = greetingsRef.current.get(characterId);
    if (greeting) {
      greetingsRef.current.delete(characterId);
      void removeGreeting(greeting);
    }
  };

  return { selectedIds, selected, add, addNamed, remove };
}

export type SetupCharacters = ReturnType<typeof useSetupCharacters>;

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  CanonicalMemoryRecord,
} from "../../../../engine/contracts/types/memory";
import { canonicalMemoryApi } from "../../../../shared/api/canonical-memory-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { characterMemoryImportPatch } from "../lib/character-memory-model";

export const characterMemoryKeys = {
  detail: (characterId: string) => ["character-memories", characterId] as const,
  chats: (characterId: string) => ["character-memory-chats", characterId] as const,
  chatRows: (chatId: string) => ["character-memory-chat-rows", chatId] as const,
};

export type CharacterMemorySourceChat = {
  id: string;
  name?: string | null;
  mode?: string | null;
  characterIds?: string[];
};

export function useCharacterMemories(characterId: string | null) {
  return useQuery({
    queryKey: characterMemoryKeys.detail(characterId ?? ""),
    queryFn: () =>
      canonicalMemoryApi.query({
        scope: { kind: "character", id: characterId! },
        includeInactive: true,
      }),
    enabled: !!characterId,
  });
}
export function useCharacterMemorySourceChats(characterId: string | null) {
  return useQuery({
    queryKey: characterMemoryKeys.chats(characterId ?? ""),
    queryFn: async () => {
      const chats = await storageApi.list<CharacterMemorySourceChat>("chats", {
        fields: ["id", "name", "mode", "characterIds"],
        orderBy: "updatedAt",
        descending: true,
      });
      return chats.filter((chat) => chat.characterIds?.includes(characterId!));
    },
    enabled: !!characterId,
  });
}

export function useChatMemoryRows(chatId: string | null) {
  return useQuery({
    queryKey: characterMemoryKeys.chatRows(chatId ?? ""),
    queryFn: () => storageApi.listChatMemories<Record<string, unknown>>(chatId!, { order: "recent" }),
    enabled: !!chatId,
  });
}

function useInvalidateCharacterMemories(characterId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: characterMemoryKeys.detail(characterId) });
}

export function useUpdateCharacterMemory(characterId: string) {
  const invalidate = useInvalidateCharacterMemories(characterId);
  return useMutation({
    mutationFn: ({ memoryId, patch }: { memoryId: string; patch: CanonicalMemoryPatch }) =>
      canonicalMemoryApi.update(memoryId, patch),
    onSuccess: invalidate,
  });
}

export function useImportCharacterMemories(characterId: string) {
  const invalidate = useInvalidateCharacterMemories(characterId);
  return useMutation({
    mutationFn: async (inputs: Array<CanonicalMemoryInput & { id: string }>) => {
      const existing = await canonicalMemoryApi.query({
        scope: { kind: "character", id: characterId },
        includeInactive: true,
      });
      const existingIds = new Set(existing.map((memory) => memory.id));
      const stored: CanonicalMemoryRecord[] = [];
      for (const input of inputs) {
        if (existingIds.has(input.id)) {
          stored.push(await canonicalMemoryApi.update(input.id, characterMemoryImportPatch(input)));
        } else {
          stored.push(await canonicalMemoryApi.create(input));
          existingIds.add(input.id);
        }
      }
      await canonicalMemoryApi.index.rebuildLexical({
        scope: { kind: "character", id: characterId },
      });
      return stored;
    },
    onSuccess: invalidate,
  });
}

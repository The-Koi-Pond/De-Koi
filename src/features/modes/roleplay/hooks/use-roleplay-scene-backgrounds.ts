// ──────────────────────────────────────────────
// Hook: staged starters and backgrounds that follow the story
// ──────────────────────────────────────────────
// A new Roleplay with a staged character gets its opening scene and sprites once (engine rule:
// starter-staging.ts). After that, each new reply that clearly moves the story to another of the characters' scene
// backgrounds switches the chat's background (scene-backgrounds.ts). No model call either way.
import { useEffect, useMemo, useRef } from "react";
import type { useUpdateChatMetadata } from "../../../catalog/chats/index";
import {
  normalizeSceneBackgrounds,
  pickSceneBackground,
} from "../../../../engine/modes/roleplay/scene/scene-backgrounds";
import { starterStagingPatch, type StagingCharacter } from "../../../../engine/modes/roleplay/scene/starter-staging";
import { chatBackgroundMetadataToUrl } from "../../../../shared/lib/backgrounds";
import { useUIStore } from "../../../../shared/stores/ui.store";
import type { MessageWithSwipes } from "../../shared/chat-ui/index";

type ChatCharacterRow = { id: string; data: Record<string, unknown> };

function isReply(message: MessageWithSwipes): boolean {
  return message.role === "assistant" || message.role === "narrator";
}

function replyKey(message: MessageWithSwipes): string {
  return `${message.id}:${message.activeSwipeIndex}`;
}

function cardExtensions(row: ChatCharacterRow): Record<string, unknown> | null {
  const extensions = row.data?.extensions;
  return extensions && typeof extensions === "object" && !Array.isArray(extensions)
    ? (extensions as Record<string, unknown>)
    : null;
}

// Saved by the metadata patch; shown right away instead of waiting for the chat to reload.
function showBackground(background: string) {
  const url = chatBackgroundMetadataToUrl(background);
  if (url) useUIStore.getState().setChatBackground(url);
}

function storedBackground(metadata: Record<string, unknown>): string | null {
  return typeof metadata.background === "string" && metadata.background.trim() ? metadata.background.trim() : null;
}

export function useRoleplaySceneBackgrounds({
  enabled,
  chatId,
  chatMeta,
  chatCharacterIds,
  characterRows,
  messages,
  isStreaming,
  updateMeta,
}: {
  enabled: boolean;
  chatId: string | null;
  chatMeta: Record<string, unknown>;
  chatCharacterIds: string[];
  characterRows: ChatCharacterRow[] | undefined;
  messages: MessageWithSwipes[] | undefined;
  isStreaming: boolean;
  updateMeta: ReturnType<typeof useUpdateChatMetadata>;
}) {
  const characters = useMemo<StagingCharacter[]>(() => {
    const rows = new Map((characterRows ?? []).map((row) => [row.id, row]));
    return chatCharacterIds.flatMap((id) => {
      const row = rows.get(id);
      return row ? [{ id, extensions: cardExtensions(row) }] : [];
    });
  }, [characterRows, chatCharacterIds]);
  const charactersLoaded = chatCharacterIds.length > 0 && characters.length === chatCharacterIds.length;
  const scenes = useMemo(
    () => characters.flatMap((character) => normalizeSceneBackgrounds(character.extensions?.sceneBackgrounds)),
    [characters],
  );

  // Right after a chat switch the transcript can still hold the previous chat's messages; they count as not loaded.
  const messagesLoaded = messages !== undefined && messages.every((message) => message.chatId === chatId);
  const replies = useMemo(() => (messagesLoaded ? (messages ?? []).filter(isReply) : []), [messages, messagesLoaded]);
  const latest = useRef({ chatMeta, replies, scenes, updateMeta });
  latest.current = { chatMeta, replies, scenes, updateMeta };

  // A new chat with a staged character: opening scene, sprites and the Expression agent, once.
  const stagedChatRef = useRef<string | null>(null);
  const stagingReady = enabled && !!chatId && messagesLoaded && charactersLoaded && !isStreaming;
  useEffect(() => {
    if (!stagingReady || !chatId || stagedChatRef.current === chatId) return;
    const { chatMeta: metadata, replies: currentReplies, updateMeta: mutate } = latest.current;
    const patch = starterStagingPatch({ metadata, characters, replyCount: currentReplies.length });
    if (!patch) return;
    stagedChatRef.current = chatId;
    mutate.mutate({ id: chatId, ...patch });
    if (patch.background) showBackground(patch.background);
  }, [stagingReady, chatId, characters]);

  // A new reply (or swipe) that moves the scene. Replies already in the chat when it opens change nothing.
  const latestReply = replies.at(-1);
  const latestKey = latestReply ? replyKey(latestReply) : null;
  const seenRef = useRef<{ chatId: string | null; keys: Set<string> | null }>({ chatId: null, keys: null });
  useEffect(() => {
    if (seenRef.current.chatId !== chatId) seenRef.current = { chatId, keys: null };
    if (!enabled || !chatId || !messagesLoaded || isStreaming) return;
    const seen = seenRef.current;
    const { chatMeta: metadata, replies: currentReplies, scenes: currentScenes, updateMeta: mutate } = latest.current;
    if (!seen.keys) {
      seen.keys = new Set(currentReplies.map(replyKey));
      return;
    }
    if (!latestKey || seen.keys.has(latestKey)) return;
    seen.keys.add(latestKey);
    const reply = currentReplies.at(-1);
    if (!reply?.content || currentScenes.length === 0) return;
    const next = pickSceneBackground(currentScenes, storedBackground(metadata), reply.content);
    if (!next) return;
    mutate.mutate({ id: chatId, background: next });
    showBackground(next);
  }, [enabled, chatId, isStreaming, latestKey, messagesLoaded]);
}

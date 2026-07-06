import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DialogueAttributionsExtra, MessageExtra, MessageSwipe } from "../../../../../engine/contracts/types/chat";
import {
  buildDialogueAttributions,
  createDialogueAttributionTextHash,
  type DialogueAttributionSpeaker,
} from "../../../../../engine/shared/text/dialogue-attribution";
import { storageApi } from "../../../../../shared/api/storage-api";
import { chatKeys } from "../../../../catalog/chats/index";
import type { CharacterMap } from "../types";

type BackfillMessage = {
  id: string;
  chatId: string;
  role?: string | null;
  content?: string | null;
  activeSwipeIndex?: number | null;
  extra?: unknown;
  swipes?: Array<Pick<MessageSwipe, "content" | "extra" | "characterId"> & { id?: string }>;
};

type BackfillCharacter = NonNullable<ReturnType<CharacterMap["get"]>>;

const inFlightBackfills = new Set<string>();
const completedBackfills = new Set<string>();

function hasDialogueAttributionsField(extra: unknown): boolean {
  return (
    !!extra &&
    typeof extra === "object" &&
    !Array.isArray(extra) &&
    Object.prototype.hasOwnProperty.call(extra, "dialogueAttributions")
  );
}

function activeSwipeForMessage(message: BackfillMessage) {
  const index = Math.max(0, Math.trunc(message.activeSwipeIndex ?? 0));
  return message.swipes?.[index] ?? null;
}

function shouldBackfillMessage(message: BackfillMessage, extra: unknown): boolean {
  if (message.role !== "assistant" && message.role !== "narrator") return false;
  const activeSwipe = activeSwipeForMessage(message);
  if (activeSwipe) return !hasDialogueAttributionsField(activeSwipe.extra);
  return !hasDialogueAttributionsField(extra);
}

function canonicalBackfillText(message: BackfillMessage): string {
  const activeSwipe = activeSwipeForMessage(message);
  return typeof activeSwipe?.content === "string" ? activeSwipe.content : String(message.content ?? "");
}

function speakerAliases(character: BackfillCharacter): string[] {
  const aliases = Array.isArray(character.speakerAliases) ? character.speakerAliases : [];
  return aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0);
}

function dialogueBackfillSpeakers(
  characterMap: CharacterMap | undefined,
  chatCharacterIds: readonly string[] | undefined,
): DialogueAttributionSpeaker[] {
  if (!characterMap) return [];
  const entries = chatCharacterIds?.length
    ? chatCharacterIds.map((id) => [id, characterMap.get(id)] as const)
    : Array.from(characterMap.entries());
  return entries
    .map(([id, character]): DialogueAttributionSpeaker | null => {
      if (!character) return null;
      const name = character.name.trim();
      if (!name) return null;
      return { id, name, aliases: speakerAliases(character) };
    })
    .filter((speaker): speaker is DialogueAttributionSpeaker => speaker !== null);
}

function buildLegacyBackfillAttributions(
  text: string,
  speakers: DialogueAttributionSpeaker[],
): DialogueAttributionsExtra {
  const result = buildDialogueAttributions(text, speakers, {
    stripSpeakerTags: false,
    stripLeadingSpeakerPrefix: false,
    includeDerivedProse: true,
  }).attributions;
  return result ?? { version: 1, textHash: createDialogueAttributionTextHash(text), segments: [] };
}

export function useLazyDialogueAttributionBackfill(args: {
  message: BackfillMessage;
  extra: MessageExtra | Record<string, unknown> | string | null | undefined;
  characterMap?: CharacterMap;
  chatCharacterIds?: readonly string[];
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const speakers = useMemo(
    () => dialogueBackfillSpeakers(args.characterMap, args.chatCharacterIds),
    [args.characterMap, args.chatCharacterIds],
  );

  useEffect(() => {
    if (args.enabled === false || !shouldBackfillMessage(args.message, args.extra)) return;
    const text = canonicalBackfillText(args.message);
    if (!text.trim()) return;
    const textHash = createDialogueAttributionTextHash(text);
    const activeSwipeIndex = Math.max(0, Math.trunc(args.message.activeSwipeIndex ?? 0));
    const key = `${args.message.id}:${activeSwipeIndex}:${textHash}`;
    if (inFlightBackfills.has(key) || completedBackfills.has(key)) return;

    const dialogueAttributions = buildLegacyBackfillAttributions(text, speakers);
    inFlightBackfills.add(key);
    // Legacy messages render neutral first by design. Backfill may improve a
    // later render, but a failed write must never reintroduce render-time
    // speaker guessing or risk showing the wrong character color.
    void storageApi
      .patchChatMessageExtra(args.message.id, { dialogueAttributions })
      .then(() => {
        completedBackfills.add(key);
        return queryClient.invalidateQueries({ queryKey: chatKeys.messages(args.message.chatId) });
      })
      .catch(() => undefined)
      .finally(() => {
        inFlightBackfills.delete(key);
      });
  }, [args.enabled, args.extra, args.message, queryClient, speakers]);
}

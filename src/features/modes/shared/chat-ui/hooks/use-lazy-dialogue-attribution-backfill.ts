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
const BACKFILL_WRITE_DELAY_MS = 300;
const BACKFILL_RETRY_DELAY_MS = 150;
const BACKFILL_MAX_WRITE_ATTEMPTS = 3;
let backfillWriteQueue: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAtomicStorageUpdateError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("Storage writes cannot run during an atomic collection update")
  );
}

function enqueueBackfillWrite(write: () => Promise<void>): Promise<void> {
  const queued = backfillWriteQueue.catch(() => undefined).then(write);
  backfillWriteQueue = queued.catch(() => undefined);
  return queued;
}

async function patchDialogueAttributionsWithRetry(
  messageId: string,
  dialogueAttributions: DialogueAttributionsExtra,
): Promise<void> {
  for (let attempt = 1; attempt <= BACKFILL_MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await storageApi.patchChatMessageExtra(messageId, { dialogueAttributions });
      return;
    } catch (error) {
      if (!isAtomicStorageUpdateError(error) || attempt === BACKFILL_MAX_WRITE_ATTEMPTS) throw error;
      await delay(BACKFILL_RETRY_DELAY_MS * attempt);
    }
  }
}

function readDialogueAttributions(extra: unknown): DialogueAttributionsExtra | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const value = (extra as { dialogueAttributions?: unknown }).dialogueAttributions;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DialogueAttributionsExtra) : null;
}

function activeSwipeForMessage(message: BackfillMessage) {
  const index = Math.max(0, Math.trunc(message.activeSwipeIndex ?? 0));
  return message.swipes?.[index] ?? null;
}

function hasBackfillableRole(message: BackfillMessage): boolean {
  return message.role === "assistant" || message.role === "narrator";
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

function dialogueAttributionsEqual(left: DialogueAttributionsExtra | null, right: DialogueAttributionsExtra): boolean {
  if (!left) return false;
  if (left.version !== right.version || left.textHash !== right.textHash) return false;
  if (!Array.isArray(left.segments) || left.segments.length !== right.segments.length) return false;
  return left.segments.every((segment, index) => {
    const expected = right.segments[index];
    return (
      segment.start === expected.start &&
      segment.end === expected.end &&
      segment.speakerName === expected.speakerName &&
      segment.speakerId === expected.speakerId &&
      segment.source === expected.source &&
      segment.confidence === expected.confidence
    );
  });
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
    if (args.enabled === false || !hasBackfillableRole(args.message)) return;
    const text = canonicalBackfillText(args.message);
    if (!text.trim()) return;
    const textHash = createDialogueAttributionTextHash(text);
    const activeSwipeIndex = Math.max(0, Math.trunc(args.message.activeSwipeIndex ?? 0));
    const key = `${args.message.id}:${activeSwipeIndex}:${textHash}`;
    if (inFlightBackfills.has(key) || completedBackfills.has(key)) return;

    const activeSwipe = activeSwipeForMessage(args.message);
    const existingAttributions = readDialogueAttributions(activeSwipe ? activeSwipe.extra : args.extra);
    const dialogueAttributions = buildLegacyBackfillAttributions(text, speakers);
    if (dialogueAttributionsEqual(existingAttributions, dialogueAttributions)) return;

    inFlightBackfills.add(key);
    let started = false;
    const timer = window.setTimeout(() => {
      started = true;
      // Legacy messages render neutral first by design. Backfill may improve a
      // later render, but a failed write must never reintroduce render-time
      // speaker guessing or risk showing the wrong character color.
      void enqueueBackfillWrite(async () => {
        await patchDialogueAttributionsWithRetry(args.message.id, dialogueAttributions);
        completedBackfills.add(key);
        await queryClient.invalidateQueries({ queryKey: chatKeys.messages(args.message.chatId) });
      })
        .catch(() => undefined)
        .finally(() => {
          inFlightBackfills.delete(key);
        });
    }, BACKFILL_WRITE_DELAY_MS);

    return () => {
      if (!started) {
        window.clearTimeout(timer);
        inFlightBackfills.delete(key);
      }
    };
  }, [args.enabled, args.extra, args.message, queryClient, speakers]);
}

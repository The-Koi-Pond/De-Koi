// ──────────────────────────────────────────────
// Trance mode: playing a session and saving what happened
// ──────────────────────────────────────────────
import type { StorageGateway } from "../../capabilities/storage";
import type { TranceAfter, TrancePhase, TranceRequest, TranceState } from "../../contracts/types/trance";
import { isRecord, parseRecord, readString } from "../../generation/runtime-records";
import { createTranceState, readTranceState, withTranceRun } from "./request";

/**
 * The button under each line. Pressing it is a small yes, so the words follow the session: agreement while going
 * down, waking words on the way up.
 */
const BUTTON_WORDS: Record<"down" | "wake" | "sleep" | "exit", readonly string[]> = {
  down: ["Yes", "Yes...", "Mmmm...", "So nice", "Feels nice"],
  wake: ["Slowly waking", "More aware", "Almost awake", "Feeling brighter"],
  sleep: ["Mmmm...", "Drifting", "So heavy", "Sleepy"],
  exit: ["Okay", "Coming up", "More aware", "Almost awake"],
};

const PRETALK_WORDS = ["Okay", "Yes", "Ready"];

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) >>> 0;
  return value;
}

/**
 * The button word for a line: picked from the line's text so a replay shows the same words, and never the same word
 * as the line before it.
 */
export function tranceButtonLabel(phase: TrancePhase | "exit", text: string, previous: string | null): string {
  const words =
    phase === "pretalk"
      ? PRETALK_WORDS
      : phase === "wake"
        ? BUTTON_WORDS.wake
        : phase === "sleep"
          ? BUTTON_WORDS.sleep
          : phase === "exit"
            ? BUTTON_WORDS.exit
            : BUTTON_WORDS.down;
  const start = hash(text) % words.length;
  for (let offset = 0; offset < words.length; offset += 1) {
    const word = words[(start + offset) % words.length]!;
    if (word !== previous) return word;
  }
  return words[start]!;
}

/** Shown when the listener stops outright: no script, just back to the room. */
export const TRANCE_STOP_LINE = "Okay. You're back. Feel your feet, take a full breath, and look around the room.";

export interface SaveTranceRequestInput {
  chatId: string;
  request: TranceRequest;
  connectionId: string | null;
  characterId: string;
}

/** Names set by the app, not the person: these follow the guiding character. */
const AUTO_NAME = /^(?:New Trance|.+ - Trance)$/;

/** True for an empty name or one the app made ("New Trance", "Jester - Trance"); the person's own names stay. */
export function isAppMadeTranceName(name: string): boolean {
  return !name.trim() || AUTO_NAME.test(name.trim());
}

/** "Jester - Trance" when the chat still has an app-made name; null when the person named it or the card is gone. */
async function tranceChatName(storage: StorageGateway, current: string, characterId: string): Promise<string | null> {
  if (!isAppMadeTranceName(current)) return null;
  const character = await storage.get("characters", characterId);
  const name = isRecord(character) ? readString(parseRecord(character.data).name).trim() : "";
  return name ? `${name} - Trance` : null;
}

/**
 * Saves a submitted request as one unit: the chat's connection, character (and app-made name), then a fresh
 * `metadata.trance` with no script (so a new one gets written). If that write fails, the chat's previous connection,
 * character and name are put back.
 */
export async function saveTranceRequest(storage: StorageGateway, input: SaveTranceRequestInput): Promise<TranceState> {
  const chat = await storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "trance") throw new Error("Only trance sessions take a trance request.");
  const previous = {
    name: readString(chat.name),
    connectionId: readString(chat.connectionId).trim() || null,
    characterIds: Array.isArray(chat.characterIds)
      ? chat.characterIds.filter((id): id is string => typeof id === "string")
      : [],
  };
  const existing = readTranceState(parseRecord(chat.metadata));
  const state: TranceState = { ...createTranceState(input.request), runs: existing?.runs ?? [] };
  const name = await tranceChatName(storage, previous.name, input.characterId);
  await storage.update("chats", input.chatId, {
    connectionId: input.connectionId,
    characterIds: [input.characterId],
    ...(name ? { name } : {}),
  });
  try {
    await storage.patchChatMetadata(input.chatId, { trance: state });
  } catch (error) {
    try {
      await storage.update("chats", input.chatId, previous);
    } catch {
      throw new Error(
        `The session couldn't be saved (${error instanceof Error ? error.message : String(error)}), and the chat's connection and character couldn't be restored. Check them before trying again.`,
      );
    }
    throw error;
  }
  return state;
}

/** Stores how a run went (newest first), read fresh so a run saved from another tab isn't lost. */
export async function recordTranceRun(storage: StorageGateway, chatId: string, run: TranceAfter): Promise<TranceState> {
  const chat = await storage.get("chats", chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  const state = readTranceState(parseRecord(chat.metadata));
  if (!state) throw new Error("This session has no request.");
  const next = withTranceRun(state, run);
  await storage.patchChatMetadata(chatId, { trance: next });
  return next;
}

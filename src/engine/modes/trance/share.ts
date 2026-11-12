// ──────────────────────────────────────────────
// Trance mode: sharing a written session as a file
// ──────────────────────────────────────────────
import type { StorageGateway } from "../../capabilities/storage";
import type { TranceRequest, TranceScript, TranceState } from "../../contracts/types/trance";
import { isRecord, parseRecord, readString } from "../../generation/runtime-records";
import { normalizeTranceRequest, normalizeTranceScript, readTranceState } from "./request";
import { isAppMadeTranceName } from "./session";

/** A problem with a shared trance, worded for the person so the screen can show it as is. */
export class TranceShareError extends Error {
  readonly code = "user_facing" as const;

  constructor(message: string) {
    super(message);
    this.name = "TranceShareError";
  }
}

export const NOT_A_SHARED_TRANCE = "That file isn't a shared trance. Shared trances end in .trance.json.";

const TRANCE_SHARE_TYPE = "de-koi-trance";
const TRANCE_SHARE_VERSION = 1;

/**
 * A written session someone can play in their own De-Koi without a model call. It carries the script, the
 * settings it was written for and the guide's name. It never carries how the sharer felt (moods and their own
 * words), their past runs or their connection.
 */
export interface TranceShareFile {
  type: typeof TRANCE_SHARE_TYPE;
  version: typeof TRANCE_SHARE_VERSION;
  exportedAt: string;
  guideName: string;
  request: TranceRequest;
  script: Pick<TranceScript, "lines" | "exits" | "createdAt">;
}

export interface SharedTrance {
  guideName: string;
  request: TranceRequest;
  script: TranceScript;
}

export function buildTranceShare(state: TranceState, guideName: string, now: Date): TranceShareFile {
  if (!state.script) throw new TranceShareError("This session hasn't been written yet, so there's nothing to share.");
  return {
    type: TRANCE_SHARE_TYPE,
    version: TRANCE_SHARE_VERSION,
    exportedAt: now.toISOString(),
    guideName: guideName.trim(),
    request: { ...state.request, moods: [], moodNote: "" },
    script: { lines: state.script.lines, exits: state.script.exits, createdAt: state.script.createdAt },
  };
}

/** "Jester - Stage Fright.trance.json": the guide and the session's title when it has one. */
export function tranceShareFilename(share: TranceShareFile): string {
  const title = share.request.pitch?.title ?? "Trance";
  const base = [share.guideName, title]
    .filter(Boolean)
    .join(" - ")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .trim();
  return `${base || "Trance"}.trance.json`;
}

/** Reads a shared session file. Throws a message meant for the person when the file isn't one. */
export function parseTranceShare(value: unknown): SharedTrance {
  if (!isRecord(value) || value.type !== TRANCE_SHARE_TYPE) {
    throw new TranceShareError(NOT_A_SHARED_TRANCE);
  }
  if (value.version !== TRANCE_SHARE_VERSION) {
    throw new TranceShareError("That shared trance was made by a newer De-Koi. Update De-Koi and open it again.");
  }
  const script = normalizeTranceScript({ ...parseRecord(value.script), connectionId: null });
  if (!script) throw new TranceShareError("That shared trance has no lines to play.");
  const request = { ...normalizeTranceRequest(value.request), moods: [], moodNote: "" };
  return { guideName: readString(value.guideName).trim().slice(0, 120), request, script };
}

/** The library card with the guide's exact name (ignoring case), so its voice and colors come along. */
async function findGuideCharacter(storage: StorageGateway, guideName: string): Promise<string | null> {
  const wanted = guideName.trim().toLowerCase();
  if (!wanted) return null;
  const rows = await storage.list<Record<string, unknown>>("characters", {
    fields: ["id", "data"],
    fieldSelections: { data: ["name"] },
  });
  const match = rows.find((row) => readString(parseRecord(row.data).name).trim().toLowerCase() === wanted);
  return match ? readString(match.id) || null : null;
}

/**
 * Puts a shared session into an empty trance chat, ready to play. A card in this library with the guide's name
 * becomes the chat's character; otherwise the chat has none and shows the guide's name.
 */
export async function openSharedTrance(
  storage: StorageGateway,
  chatId: string,
  shared: SharedTrance,
): Promise<TranceState> {
  const chat = await storage.get("chats", chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "trance") throw new TranceShareError("Only trance sessions can open a shared trance.");
  if (readTranceState(parseRecord(chat.metadata))) {
    throw new TranceShareError("This session already has settings. Start a new trance to open a shared one.");
  }
  const characterId = await findGuideCharacter(storage, shared.guideName);
  const state: TranceState = {
    version: 1,
    request: shared.request,
    script: shared.script,
    runs: [],
    ...(shared.guideName ? { guideName: shared.guideName } : {}),
  };
  await storage.update("chats", chatId, {
    characterIds: characterId ? [characterId] : [],
    ...(shared.guideName && isAppMadeTranceName(readString(chat.name)) ? { name: `${shared.guideName} - Trance` } : {}),
  });
  await storage.patchChatMetadata(chatId, { trance: state });
  return state;
}

// ──────────────────────────────────────────────
// Trance mode: a session made from a chat, roleplay or fic
// ──────────────────────────────────────────────
// The source's model reads it and suggests three sessions in its character's voice, each drawn from what happened
// there. A new trance session opens on those ideas with that character as the guide; the person picks one (or tweaks
// it, or builds their own) and nothing is written until then. The source itself is left as it is.
import type { LlmGateway } from "../../capabilities/llm";
import type { StorageGateway } from "../../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../contracts/types/sidecar";
import { resolveBackgroundTextConnection } from "../../generation/background-llm-connection";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../generation/runtime-records";
import { userFacingError } from "../../shared/user-facing-error";
import { suggestTrancePitches, type TrancePitch } from "./pitches";
import { normalizeTranceRequest, readTranceState } from "./request";
import { isAppMadeTranceName } from "./session";
import { TRANCE_SOURCE_MODES, type TranceSource } from "./source";

const NO_CONNECTION = "Add a model connection first, then try again.";

/** The ideas a session made from a chat opens on, until a request is saved (`metadata.tranceDraft`). */
export function readTranceDraftPitches(metadata: unknown): TrancePitch[] {
  const raw = parseRecord(parseRecord(metadata).tranceDraft);
  if (raw.version !== 1 || !Array.isArray(raw.pitches)) return [];
  return raw.pitches.flatMap((item): TrancePitch[] => {
    if (!isRecord(item)) return [];
    const request = normalizeTranceRequest(item.request);
    const title = readString(item.title).trim();
    return title && request.pitch ? [{ title, summary: readString(item.summary).trim(), request }] : [];
  });
}

/** The character ids on a chat, in order. */
function characterIds(chat: JsonRecord): string[] {
  return Array.isArray(chat.characterIds)
    ? chat.characterIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

/** The source's own model, else the app's default text model. */
async function sourceConnection(storage: StorageGateway, chat: JsonRecord): Promise<string> {
  const own = readString(chat.connectionId).trim();
  if (own && (own === LOCAL_SIDECAR_CONNECTION_ID || isRecord(await storage.get("connections", own)))) return own;
  const fallback = await resolveBackgroundTextConnection(storage).catch(() => null);
  const id = readString(fallback?.id).trim();
  if (!id) throw userFacingError(NO_CONNECTION);
  return id;
}

async function characterName(storage: StorageGateway, characterId: string): Promise<string> {
  const row = await storage.get("characters", characterId);
  return isRecord(row) ? readString(parseRecord(row.data).name).trim() : "";
}

interface TranceDraftFromChat {
  guideId: string;
  guideName: string;
  connectionId: string;
  metadata: { tranceSource: TranceSource; tranceDraft: { version: 1; pitches: TrancePitch[] } };
}

/** Reads the source and drafts three ideas from it, guided by one of its characters (the first by default). */
async function draftFromChat(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { chatId: string; characterId?: string | null },
  signal: AbortSignal | undefined,
): Promise<TranceDraftFromChat> {
  const chat = await deps.storage.get<JsonRecord>("chats", input.chatId);
  if (!isRecord(chat)) throw userFacingError("That chat is no longer here.");
  const mode = readString(chat.mode).trim();
  if (!TRANCE_SOURCE_MODES.has(mode))
    throw userFacingError("Only chats, roleplays and fics can be turned into a trance.");
  const ids = characterIds(chat);
  const wanted = input.characterId?.trim();
  const guideId = wanted && ids.includes(wanted) ? wanted : ids[0];
  if (!guideId) throw userFacingError("This chat has no character to guide a trance.");

  const connectionId = await sourceConnection(deps.storage, chat);
  const pitches = await suggestTrancePitches(
    deps,
    { connectionId, characterId: guideId, moods: [], moodNote: "", idea: "", sourceChatId: input.chatId },
    signal,
  );
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  const source: TranceSource = { version: 1, chatId: input.chatId, mode, name: readString(chat.name) };
  return {
    guideId,
    guideName: await characterName(deps.storage, guideId),
    connectionId,
    metadata: { tranceSource: source, tranceDraft: { version: 1, pitches } },
  };
}

/**
 * Makes a new trance session from a chat, roleplay or fic, guided by one of its characters (the first by default).
 * Returns the new session's chat; it opens on three ideas drawn from the source.
 */
export async function startTranceFromChat(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { chatId: string; characterId?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<JsonRecord> {
  const draft = await draftFromChat(deps, input, options.signal);
  return deps.storage.create<JsonRecord>("chats", {
    // An app-made name, so it keeps following the guide if they change it on the form.
    name: draft.guideName ? `${draft.guideName} - Trance` : "New Trance",
    mode: "trance",
    characterIds: [draft.guideId],
    groupId: null,
    folderId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: draft.connectionId,
    connectedChatId: null,
    metadata: draft.metadata,
  });
}

/**
 * Bases a new, still-empty trance session on a chat, roleplay or fic ("Start from one of your chats" on the session
 * form): the same three ideas as {@link startTranceFromChat}, put into this session instead of a new one.
 */
export async function baseTranceOnChat(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: { tranceChatId: string; chatId: string; characterId?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const session = await deps.storage.get<JsonRecord>("chats", input.tranceChatId);
  if (!isRecord(session) || readString(session.mode) !== "trance") throw userFacingError("This session is gone.");
  if (readTranceState(parseRecord(session.metadata))) {
    throw userFacingError("This session already has settings. Start a new trance to base one on a chat.");
  }
  const draft = await draftFromChat(deps, input, options.signal);
  await deps.storage.update("chats", input.tranceChatId, {
    characterIds: [draft.guideId],
    connectionId: draft.connectionId,
    ...(draft.guideName && isAppMadeTranceName(readString(session.name))
      ? { name: `${draft.guideName} - Trance` }
      : {}),
  });
  await deps.storage.patchChatMetadata(input.tranceChatId, draft.metadata);
}

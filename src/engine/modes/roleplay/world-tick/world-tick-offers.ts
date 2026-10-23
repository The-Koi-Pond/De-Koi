import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayWorldTickState, WorldTickOffer } from "../../../contracts/types/roleplay-world-tick";
import { parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { detectExplicitTimeSkip } from "./time-skip-detection";
import {
  normalizeWorldTickState,
  recordWorldTickOffer,
  WORLD_TICK_METADATA_KEY,
  type RecordWorldTickOfferInput,
  type WorldTickStateOptions,
} from "./world-tick-state";

/**
 * Offers to let time pass at clear story boundaries: a formal scene ended, or the user's own
 * message jumped ahead in time. An offer is a note on the chat and nothing more: no model call and
 * no chat message until the user takes it and reviews the events. Only these two calls make
 * offers, so opening a chat or leaving it idle never does.
 */

export type WorldTickOfferOutcome =
  | { offered: true; offer: WorldTickOffer; state: RoleplayWorldTickState }
  | {
      offered: false;
      reason: "offers_off" | "already_offered" | "review_open" | "invalid" | "not_roleplay" | "chat_not_found";
    };

const MAX_ATTEMPTS = 3;

function chatMode(chat: JsonRecord): string {
  return readString(chat.mode).trim();
}

/**
 * Records the offer unless this boundary was offered before. Concurrent writers (another window,
 * a duplicate callback) are handled by the conditional write: on a clash the state is read again
 * and the boundary check decides, so the same boundary can't be offered twice.
 */
export async function offerWorldTick(
  storage: StorageGateway,
  chatId: string,
  input: RecordWorldTickOfferInput,
  options: WorldTickStateOptions = {},
): Promise<WorldTickOfferOutcome> {
  const updateChatIfUnchanged = storage.updateChatIfUnchanged;
  if (!updateChatIfUnchanged) throw new Error("This runtime can't save time-skip offers safely.");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const now = options.now?.() ?? new Date().toISOString();
    const chat = await storage.get<JsonRecord>("chats", chatId);
    if (!chat) return { offered: false, reason: "chat_not_found" };
    const metadata = parseRecord(chat.metadata);
    if (chatMode(chat) !== "roleplay" || metadata.sceneStatus === "concluded") {
      return { offered: false, reason: "not_roleplay" };
    }
    const raw = metadata[WORLD_TICK_METADATA_KEY] ?? null;
    const result = recordWorldTickOffer(normalizeWorldTickState(raw, now), input, options);
    if (!result.offered) return result;
    const written = (await updateChatIfUnchanged.call(
      storage,
      chatId,
      { metadata: { [WORLD_TICK_METADATA_KEY]: raw } },
      { metadata: { [WORLD_TICK_METADATA_KEY]: result.state } },
    )) as { updated: boolean; chat: JsonRecord };
    if (written.updated) {
      const state = normalizeWorldTickState(parseRecord(written.chat.metadata)[WORLD_TICK_METADATA_KEY], now);
      return state.offer ? { offered: true, offer: state.offer, state } : { offered: false, reason: "invalid" };
    }
  }
  throw new Error("The chat kept changing while a time skip was being offered.");
}

/**
 * After a formal scene concludes, offers time passing in the chat it returns to. The boundary is
 * the scene plus its last message, so a repeated conclude callback is a no-op while reopening the
 * scene, playing on and concluding again is a new boundary.
 */
export async function offerWorldTickAfterScene(
  storage: StorageGateway,
  input: { originChatId: string; sceneChatId: string },
  options: WorldTickStateOptions = {},
): Promise<WorldTickOfferOutcome> {
  const scene = await storage.get<JsonRecord>("chats", input.sceneChatId);
  if (!scene) return { offered: false, reason: "chat_not_found" };
  const [last] = await storage.listChatMessages<JsonRecord>(input.sceneChatId, {
    fields: ["id", "createdAt"],
    orderBy: "createdAt",
    descending: true,
    limit: 1,
  });
  const lastMessageId = readString(last?.id).trim() || "empty";
  return offerWorldTick(
    storage,
    input.originChatId,
    {
      boundaryKey: `scene:${input.sceneChatId}:${lastMessageId}`,
      trigger: "scene_concluded",
      elapsed: "",
      label: readString(scene.name).trim() || "The scene",
    },
    options,
  );
}

/**
 * When the user's own message jumps ahead in time, offers to fill in what happened meanwhile. The
 * boundary is the message before it plus the phrase, so retrying or re-sending the same turn never
 * offers twice.
 */
export async function offerWorldTickForUserMessage(
  storage: StorageGateway,
  input: { chatId: string; content: string; previousMessageId: string | null },
  options: WorldTickStateOptions = {},
): Promise<WorldTickOfferOutcome | null> {
  const skip = detectExplicitTimeSkip(input.content);
  if (!skip) return null;
  return offerWorldTick(
    storage,
    input.chatId,
    {
      boundaryKey: `time_skip:${input.previousMessageId ?? "start"}:${skip.phrase.toLowerCase()}`,
      trigger: "time_skip",
      elapsed: skip.elapsed,
      label: skip.phrase,
    },
    options,
  );
}

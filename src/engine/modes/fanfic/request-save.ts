import type { StorageGateway } from "../../capabilities/storage";
import type { FanficRequest, FanficState } from "../../contracts/types/fanfic";
import { isRecord, readString } from "../../generation/runtime-records";
import { createFanficState } from "./request";

export interface SaveFanficRequestInput {
  chatId: string;
  request: FanficRequest;
  connectionId: string | null;
  characterIds: string[];
}

export class FanficRequestSaveError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown, rollbackFailed: boolean) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      rollbackFailed
        ? `The request could not be saved (${reason}), and the chat's connection and linked characters could not be restored. Check them in the sidebar before trying again.`
        : `The request could not be saved (${reason}). Nothing was changed; try again.`,
    );
    this.name = "FanficRequestSaveError";
    this.cause = cause;
  }
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Saves a submitted request as one unit: the chat's connection and linked cards, then a fresh
 * `metadata.fanfic` (no outline, so planning starts over). If the request write fails, the chat's
 * previous connection and cards are put back, so a half-saved submit never reaches planning.
 */
export async function saveFanficRequest(storage: StorageGateway, input: SaveFanficRequestInput): Promise<FanficState> {
  const chat = await storage.get("chats", input.chatId);
  if (!isRecord(chat)) throw new Error("Chat was not found.");
  if (readString(chat.mode) !== "fanfic") throw new Error("Only fanfic chats take a fanfic request.");
  const previous = {
    connectionId: readString(chat.connectionId).trim() || null,
    characterIds: stringIds(chat.characterIds),
  };
  const state = createFanficState(input.request);

  await storage.update("chats", input.chatId, {
    connectionId: input.connectionId,
    characterIds: input.characterIds,
  });
  try {
    await storage.patchChatMetadata(input.chatId, { fanfic: state });
  } catch (error) {
    let rollbackFailed = false;
    try {
      await storage.update("chats", input.chatId, previous);
    } catch {
      rollbackFailed = true;
    }
    throw new FanficRequestSaveError(error, rollbackFailed);
  }
  return state;
}

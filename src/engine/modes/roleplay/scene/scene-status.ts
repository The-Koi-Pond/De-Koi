// Reading a chat's scene state. Kept free of storage and model imports so the generation path can check it cheaply.
import { userFacingError } from "../../../shared/user-facing-error";
import { isRecord, readString } from "../../../shared/value-readers";

const CONCLUDED_SCENE_SEND_REFUSAL = "This scene is concluded. Convert or reopen it before sending new messages.";
export const SCENE_INSIDE_SCENE_REFUSAL = "Finish this scene first.";

function metadataOf(chat: unknown): Record<string, unknown> {
  if (!isRecord(chat)) return {};
  const raw = chat.metadata;
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function sceneStatusOf(chat: unknown): "active" | "concluded" | null {
  const status = readString(metadataOf(chat).sceneStatus).trim();
  return status === "active" || status === "concluded" ? status : null;
}

export function isActiveSceneChat(chat: unknown): boolean {
  return sceneStatusOf(chat) === "active";
}

function isConcludedSceneChat(chat: unknown): boolean {
  return sceneStatusOf(chat) === "concluded";
}

/** Refuses a new message in a concluded scene, with the reason the user sees. */
export function assertSceneAcceptsMessages(chat: unknown): void {
  if (isConcludedSceneChat(chat)) throw userFacingError(CONCLUDED_SCENE_SEND_REFUSAL);
}

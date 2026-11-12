// ──────────────────────────────────────────────
// Texts-first photos: when a character texting first also sends a photo
// ──────────────────────────────────────────────
// A character who texts first can attach a selfie through the normal [selfie] command. This module decides, once
// per texts-first message, whether this one carries a photo: the chat's per-character frequency (never / rare /
// sometimes, default rare), a cap of one photo per burst (everything the character sent since the user's last
// message), and the chat's selfie setup (an image connection plus selfie commands on). The roll is the source of
// truth: "send" means the reply gets a photo, "withhold" means a stray [selfie] tag is dropped.

import { conversationSelfieCommandEnabled } from "../commands/activation";
import { isRecord, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";

const UNPROMPTED_PHOTO_FREQUENCIES = ["never", "rare", "sometimes"] as const;
export type UnpromptedPhotoFrequency = (typeof UNPROMPTED_PHOTO_FREQUENCIES)[number];
const DEFAULT_UNPROMPTED_PHOTO_FREQUENCY: UnpromptedPhotoFrequency = "rare";

/** Chance that one texts-first message carries a photo. */
const UNPROMPTED_PHOTO_CHANCE: Record<UnpromptedPhotoFrequency, number> = {
  never: 0,
  rare: 0.15,
  sometimes: 0.4,
};

export type TextsFirstPhotoDecision = "send" | "withhold";

function isUnpromptedPhotoFrequency(value: unknown): value is UnpromptedPhotoFrequency {
  return typeof value === "string" && (UNPROMPTED_PHOTO_FREQUENCIES as readonly string[]).includes(value);
}

export function unpromptedPhotoFrequency(chatMetadata: unknown, characterId: string): UnpromptedPhotoFrequency {
  const value = parseRecord(parseRecord(chatMetadata).unpromptedPhotoFrequency)[characterId];
  return isUnpromptedPhotoFrequency(value) ? value : DEFAULT_UNPROMPTED_PHOTO_FREQUENCY;
}

/** Whether a message carries a photo (an image attachment). */
export function messageHasPhoto(extra: unknown): boolean {
  const attachments = parseRecord(extra).attachments;
  return (
    Array.isArray(attachments) &&
    attachments.some((attachment) => isRecord(attachment) && readString(attachment.type).startsWith("image"))
  );
}

/** Whether a message carries a photo or a voice note. */
function messageHasMedia(extra: unknown): boolean {
  const attachments = parseRecord(extra).attachments;
  return (
    Array.isArray(attachments) &&
    attachments.some(
      (attachment) =>
        isRecord(attachment) &&
        (readString(attachment.type).startsWith("image") || readString(attachment.type) === "audio"),
    )
  );
}

/**
 * Whether anything since the user's last message already carried a photo or a voice note: texting first, a
 * character sends at most one such media message until the user replies.
 */
export function burstAlreadyHasMedia(messages: readonly JsonRecord[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const role = readString(message.role);
    if (role === "user") return false;
    if (role === "assistant" && messageHasMedia(message.extra)) return true;
  }
  return false;
}

export function decideTextsFirstPhoto(args: {
  chat: JsonRecord;
  characterId: string;
  /** The chat's recent messages, oldest first (role + extra.attachments is enough). */
  messages: readonly JsonRecord[];
  random?: () => number;
}): TextsFirstPhotoDecision {
  const metadata = parseRecord(args.chat.metadata);
  if (!readString(metadata.imageGenConnectionId).trim()) return "withhold";
  if (!conversationSelfieCommandEnabled(args.chat)) return "withhold";
  const chance = UNPROMPTED_PHOTO_CHANCE[unpromptedPhotoFrequency(metadata, args.characterId)];
  if (chance <= 0) return "withhold";
  if (burstAlreadyHasMedia(args.messages)) return "withhold";
  return (args.random ?? Math.random)() < chance ? "send" : "withhold";
}

/** "(sent a photo: …)" after a Conversation message that carried one, so the model knows what it sent. */
export function sentPhotoHistoryNote(extra: unknown): string {
  const attachments = parseRecord(extra).attachments;
  if (!Array.isArray(attachments)) return "";
  const notes = attachments
    .filter((attachment): attachment is JsonRecord => isRecord(attachment) && readString(attachment.type) === "image")
    .map((attachment) => {
      const description = readString(attachment.description).replace(/\s+/g, " ").trim();
      return description ? `(sent a photo: ${description})` : "(sent a photo)";
    });
  return notes.join(" ");
}

// ──────────────────────────────────────────────
// Voice notes: a Conversation character sends a reply as a short voice message
// ──────────────────────────────────────────────
// The engine rolls once per Conversation reply (and per text a character sends first) against the chat's
// per-character frequency (never / rare / sometimes, default rare). On "send" the prompt asks for something short
// to say out loud, and after the reply is written its text is spoken with the character's Text to Speech voice and
// kept as a managed audio file of the chat. The text stays the message content, so it is the transcript, and the
// model reads it like any other message. Skipped when Text to Speech isn't set up.

import { isRecord, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";

const VOICE_NOTE_FREQUENCIES = ["never", "rare", "sometimes"] as const;
export type VoiceNoteFrequency = (typeof VOICE_NOTE_FREQUENCIES)[number];
const DEFAULT_VOICE_NOTE_FREQUENCY: VoiceNoteFrequency = "rare";

/** Chance that one reply, or one text sent first, is a voice note. */
const VOICE_NOTE_CHANCE: Record<VoiceNoteFrequency, number> = {
  never: 0,
  rare: 0.08,
  sometimes: 0.25,
};

/** The longest text spoken as one voice note; the Rust side refuses longer text. */
const MAX_VOICE_NOTE_CHARS = 600;

function isVoiceNoteFrequency(value: unknown): value is VoiceNoteFrequency {
  return typeof value === "string" && (VOICE_NOTE_FREQUENCIES as readonly string[]).includes(value);
}

export function voiceNoteFrequency(chatMetadata: unknown, characterId: string): VoiceNoteFrequency {
  const value = parseRecord(parseRecord(chatMetadata).voiceNoteFrequency)[characterId];
  return isVoiceNoteFrequency(value) ? value : DEFAULT_VOICE_NOTE_FREQUENCY;
}

function attachmentsOf(extra: unknown): JsonRecord[] {
  const attachments = parseRecord(extra).attachments;
  return Array.isArray(attachments) ? attachments.filter(isRecord) : [];
}

export function isVoiceNoteAttachment(attachment: unknown): boolean {
  return isRecord(attachment) && readString(attachment.type) === "audio" && attachment.voiceNote === true;
}

/** Whether a message was sent as a voice note. */
export function messageHasVoiceNote(extra: unknown): boolean {
  return attachmentsOf(extra).some(isVoiceNoteAttachment);
}

/** "(sent as a voice message)" after a Conversation message that was one; its text is the transcript. */
export function voiceNoteHistoryNote(extra: unknown): string {
  return messageHasVoiceNote(extra) ? "(sent as a voice message)" : "";
}

export function decideVoiceNote(args: {
  chat: JsonRecord;
  characterId: string;
  /** The chat's recent messages, oldest first (role + extra.attachments is enough). */
  messages: readonly JsonRecord[];
  textsFirst: boolean;
  /** Texting first, a photo already takes this burst's one media message. */
  sendsPhoto: boolean;
  /** Texting first, something since the user's last message already carried a photo or voice note. */
  burstHasMedia: boolean;
  random?: () => number;
}): boolean {
  if (readString(args.chat.mode || args.chat.chatMode) !== "conversation") return false;
  const chance = VOICE_NOTE_CHANCE[voiceNoteFrequency(args.chat.metadata, args.characterId)];
  if (chance <= 0) return false;
  if (args.textsFirst && (args.sendsPhoto || args.burstHasMedia)) return false;
  // Never two voice notes in a row: the latest message from anyone wasn't one.
  const latest = [...args.messages].reverse().find((message) => readString(message.role) !== "system");
  if (latest && messageHasVoiceNote(latest.extra)) return false;
  return (args.random ?? Math.random)() < chance;
}

/** What the reply prompt says when this reply will be sent as a voice note. */
export const VOICE_NOTE_REPLY_INSTRUCTION =
  "Send this reply as a short voice message. Write only the words you say out loud, as you would say them: under 60 words, no emoji, no actions, asterisks or stage directions, and no hidden command tags.";

/** Text to speak for a voice note, or null when the reply can't be one (empty or too long). */
export function voiceNoteText(content: string): string | null {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_VOICE_NOTE_CHARS) return null;
  return text;
}

export function buildVoiceNoteAttachment(file: { url: string; filename: string; contentType: string }): JsonRecord {
  return {
    type: "audio",
    voiceNote: true,
    url: file.url,
    filename: file.filename,
    contentType: file.contentType,
  };
}

// What a character's message carried, for notifications that say so without showing it.
import { messageHasPhoto } from "../autonomous/unprompted-photos";
import { messageHasVoiceNote } from "../voice-notes/voice-notes";

export type SentMediaKind = "photo" | "voice";

/** From a reply's generation events: a voice note wins over a photo (it is the message itself). */
export function sentMediaFromEvents(events: readonly { type: string }[]): SentMediaKind | null {
  if (events.some((event) => event.type === "voice_note")) return "voice";
  if (events.some((event) => event.type === "selfie")) return "photo";
  return null;
}

/** From a saved message's extra. */
export function sentMediaFromExtra(extra: unknown): SentMediaKind | null {
  if (messageHasVoiceNote(extra)) return "voice";
  if (messageHasPhoto(extra)) return "photo";
  return null;
}

/** "Mira sent a voice message" / "Mira sent a photo", or null for a plain text. */
export function sentMediaTitle(name: string, kind: SentMediaKind | null | undefined): string | null {
  if (kind === "voice") return `${name} sent a voice message`;
  if (kind === "photo") return `${name} sent a photo`;
  return null;
}

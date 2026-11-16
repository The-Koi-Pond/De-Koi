// ──────────────────────────────────────────────
// Voice calls: delivery tags the voice performs
// ──────────────────────────────────────────────
// Voices that read audio tags (ElevenLabs Eleven v3 and v4) perform "[sighs]" or "[laughs]" as a sigh or a laugh
// instead of saying the word. On a call with such a voice the character may open a line with one, so a sad line
// sounds sad. The tags are only for the voice: the saved text and the call screen never show them.

/** The tags offered to the model. Only these are hidden again, so ordinary brackets in a reply are left alone. */
export const VOICE_CALL_DELIVERY_TAGS = [
  "laughs",
  "chuckles",
  "sighs",
  "whispers",
  "gasps",
  "excited",
  "nervous",
  "sarcastic",
  "curious",
  "crying",
  "angry",
  "sad",
] as const;

export const VOICE_CALL_DELIVERY_INSTRUCTION = `This reply is spoken out loud on a voice call. Where a line calls for it, start that line with one delivery tag the voice will perform: ${VOICE_CALL_DELIVERY_TAGS.map((tag) => `[${tag}]`).join(", ")}. Use at most two in a reply, only where a person on the phone would audibly do it; most lines need none. Never mention or explain the tags.`;

const DELIVERY_TAG = new RegExp(`\\[(?:${VOICE_CALL_DELIVERY_TAGS.join("|")})\\][ \\t]*`, "gi");

/** `text` without the delivery tags (and the space after each), as it is saved and shown. */
export function stripDeliveryTags(text: string): string {
  return text.replace(DELIVERY_TAG, "");
}

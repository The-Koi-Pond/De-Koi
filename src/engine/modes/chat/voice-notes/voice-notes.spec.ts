import { describe, expect, it } from "vitest";
import { sentMediaFromEvents, sentMediaFromExtra, sentMediaTitle } from "../core/sent-media";
import { decideVoiceNote, voiceNoteHistoryNote, voiceNoteText } from "./voice-notes";

const voiceExtra = { attachments: [{ type: "audio", voiceNote: true, url: "/v.mp3", filename: "v.mp3" }] };
const chat = (metadata: Record<string, unknown> = {}) => ({ id: "c", mode: "conversation", metadata });
const user = { role: "user", extra: {} };
const voice = { role: "assistant", extra: voiceExtra };
const decide = (overrides: Partial<Parameters<typeof decideVoiceNote>[0]> = {}) =>
  decideVoiceNote({
    chat: chat(),
    characterId: "mira",
    messages: [user],
    textsFirst: false,
    sendsPhoto: false,
    burstHasMedia: false,
    random: () => 0.05,
    ...overrides,
  });

describe("voice notes", () => {
  it("rolls against the character's frequency, default rare", () => {
    expect(decide()).toBe(true); // rare = 8%
    expect(decide({ random: () => 0.1 })).toBe(false);
    expect(decide({ chat: chat({ voiceNoteFrequency: { mira: "sometimes" } }), random: () => 0.2 })).toBe(true);
    expect(decide({ chat: chat({ voiceNoteFrequency: { mira: "never" } }), random: () => 0 })).toBe(false);
    expect(decide({ chat: { id: "c", mode: "roleplay", metadata: {} }, random: () => 0 })).toBe(false);
  });

  it("never sends two in a row, and texting first shares the one-media cap with photos", () => {
    expect(decide({ messages: [user, voice], random: () => 0 })).toBe(false);
    expect(decide({ textsFirst: true, sendsPhoto: true, random: () => 0 })).toBe(false);
    expect(decide({ textsFirst: true, burstHasMedia: true, random: () => 0 })).toBe(false);
    expect(decide({ textsFirst: true, random: () => 0 })).toBe(true);
  });

  it("speaks only short, non-empty replies", () => {
    expect(voiceNoteText("  hey\n\nyou up?  ")).toBe("hey you up?");
    expect(voiceNoteText("   ")).toBeNull();
    expect(voiceNoteText("a".repeat(601))).toBeNull();
  });

  it("tells the model and notifications what was sent, never the content", () => {
    expect(voiceNoteHistoryNote(voiceExtra)).toBe("(sent as a voice message)");
    expect(voiceNoteHistoryNote({})).toBe("");
    expect(sentMediaFromExtra(voiceExtra)).toBe("voice");
    expect(sentMediaFromEvents([{ type: "token" }, { type: "selfie" }])).toBe("photo");
    expect(sentMediaFromEvents([{ type: "selfie" }, { type: "voice_note" }])).toBe("voice");
    expect(sentMediaTitle("Mira", "voice")).toBe("Mira sent a voice message");
    expect(sentMediaTitle("Mira", null)).toBeNull();
  });
});

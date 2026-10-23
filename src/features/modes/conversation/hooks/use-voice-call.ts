// ──────────────────────────────────────────────
// Hook: Voice call with a Conversation character
// ──────────────────────────────────────────────
// Shows the chat's voice session (engine/shared/voice-session). Hands-free: listen → transcribe → send as your
// text → the character replies out loud with their Text to Speech voice while it streams → listen again. With
// provider transcription the call keeps listening while the character talks, so you can cut in. Everything said
// stays in the chat as normal texts.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { VoiceSessionSnapshot } from "../../../../engine/shared/voice-session/voice-session";
import type { VoiceCallCharacter } from "../lib/voice-call-ports";
import { hangUpVoiceCall, holdVoiceCallSession, voiceCallSessionFor } from "../lib/voice-call-sessions";

export type { VoiceCallCharacter } from "../lib/voice-call-ports";
export type { VoiceSessionPhase as VoiceCallPhase } from "../../../../engine/shared/voice-session/voice-session";

export interface VoiceCall extends VoiceSessionSnapshot {
  toggleMute: () => void;
  /** Ends the call: the microphone closes and the voice stops at once. */
  hangUp: () => void;
  /** Cuts the character off, including a reply still being written, and goes back to listening. */
  interrupt: () => void;
}

export function useVoiceCall({
  chatId,
  character,
  sendText,
}: {
  chatId: string;
  character: VoiceCallCharacter;
  /** Sends your words as a text and resolves when the character's reply is done (false when none came). */
  sendText: (text: string) => Promise<boolean>;
}): VoiceCall {
  const session = voiceCallSessionFor({ chatId, character, sendText });
  useEffect(() => holdVoiceCallSession(chatId, session), [chatId, session]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const toggleMute = useCallback(() => session.setMuted(!session.getSnapshot().muted), [session]);
  const hangUp = useCallback(() => hangUpVoiceCall(chatId, session), [chatId, session]);
  const interrupt = useCallback(() => session.interrupt(), [session]);
  return { ...snapshot, toggleMute, hangUp, interrupt };
}

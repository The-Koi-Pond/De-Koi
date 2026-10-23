// ──────────────────────────────────────────────
// Voice calls: one live session per chat, outside React
// ──────────────────────────────────────────────
// The session lives here rather than in a component, so a remount of the call screen (React's development
// double-mount included) picks the same call back up instead of opening a second microphone. When nothing has held
// a session for a moment it is ended, which closes its microphone.
import { createVoiceSession, type VoiceSession } from "../../../../engine/shared/voice-session/voice-session";
import { holdChatAutoplay } from "../../../../shared/lib/chat-autoplay-hold";
import { createVoiceCallPorts, type VoiceCallContext } from "./voice-call-ports";

interface Entry {
  session: VoiceSession;
  context: VoiceCallContext;
  holders: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

/** The chat's call, created if there is none (or the last one has ended). Not started until held. */
export function voiceCallSessionFor(context: VoiceCallContext): VoiceSession {
  const existing = entries.get(context.chatId);
  if (existing && existing.session.getSnapshot().phase !== "ended") {
    existing.context = context;
    return existing.session;
  }
  const entry: Entry = { session: null as unknown as VoiceSession, context, holders: 0, releaseTimer: null };
  entry.session = createVoiceSession(createVoiceCallPorts(() => entry.context));
  entries.set(context.chatId, entry);
  return entry.session;
}

/** Starts the call (once) and keeps it alive until the returned release runs. */
export function holdVoiceCallSession(chatId: string, session: VoiceSession): () => void {
  const entry = entries.get(chatId);
  if (!entry || entry.session !== session) {
    // Not the chat's current call (it was hung up meanwhile): nothing to hold.
    return () => undefined;
  }
  entry.holders += 1;
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = null;
  session.start();
  // While the call is open the chat's own autoplay stays quiet (each reply also holds it until it is done).
  const releaseAutoplay = holdChatAutoplay(chatId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAutoplay();
    entry.holders -= 1;
    if (entry.holders > 0) return;
    entry.releaseTimer = setTimeout(() => {
      if (entry.holders > 0) return;
      if (entries.get(chatId) === entry) entries.delete(chatId);
      entry.session.end();
    }, 0);
  };
}

export function hangUpVoiceCall(chatId: string, session: VoiceSession): void {
  const entry = entries.get(chatId);
  if (entry?.session === session) {
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entries.delete(chatId);
  }
  session.end();
}

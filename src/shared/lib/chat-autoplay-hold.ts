// ──────────────────────────────────────────────
// Holding a chat's Text to Speech autoplay
// ──────────────────────────────────────────────
// A voice call speaks its chat's replies itself, piece by piece. The chat's own autoplay would read the same reply
// again (and stop the call's voice to do it), including a reply the user just cut off. While a hold is in place for
// a chat, its autoplay stays quiet.

const holds = new Map<string, number>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) listener();
}

/** Keeps the chat's autoplay quiet until the returned release runs. */
export function holdChatAutoplay(chatId: string): () => void {
  holds.set(chatId, (holds.get(chatId) ?? 0) + 1);
  changed();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (holds.get(chatId) ?? 1) - 1;
    if (count > 0) holds.set(chatId, count);
    else holds.delete(chatId);
    changed();
  };
}

export function chatAutoplayHeld(chatId: string | null): boolean {
  return chatId !== null && (holds.get(chatId) ?? 0) > 0;
}

export function subscribeChatAutoplayHolds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ──────────────────────────────────────────────
// Zustand Store: pending "jump to this message" request
// ──────────────────────────────────────────────
// Set by message search results; the open chat's transcript loads older pages until the message is
// loaded, scrolls it into view, highlights it, then clears the request.
import { create } from "zustand";

export interface MessageJumpTarget {
  chatId: string;
  messageId: string;
  /** Distinguishes two clicks on the same result so the second one still scrolls. */
  requestedAt: number;
}

interface MessageJumpState {
  target: MessageJumpTarget | null;
  requestJump: (chatId: string, messageId: string) => void;
  clearJump: (requestedAt: number) => void;
}

export const useMessageJumpStore = create<MessageJumpState>((set) => ({
  target: null,
  requestJump: (chatId, messageId) => set({ target: { chatId, messageId, requestedAt: Date.now() } }),
  clearJump: (requestedAt) => set((state) => (state.target?.requestedAt === requestedAt ? { target: null } : state)),
}));

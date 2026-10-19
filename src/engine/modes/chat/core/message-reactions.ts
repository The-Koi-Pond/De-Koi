// ──────────────────────────────────────────────
// Conversation message reactions (tapbacks)
// ──────────────────────────────────────────────
// Stored on message.extra.reactions. Each reactor (the user, or one character) has at most one reaction per
// message, like a phone tapback: reacting again replaces it, reacting with the same emoji removes it.

export const USER_REACTOR = "user";

/** The quick picks shown first in the reaction picker. */
export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "👎"] as const;

export interface MessageReaction {
  emoji: string;
  /** "user", or the reacting character's id. */
  by: string;
  at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the reactions saved on a message's extra, dropping malformed entries and duplicate reactors. */
export function readMessageReactions(extra: unknown): MessageReaction[] {
  const record = isRecord(extra) ? extra : typeof extra === "string" ? parseExtra(extra) : {};
  const raw = Array.isArray(record.reactions) ? record.reactions : [];
  const seen = new Set<string>();
  const reactions: MessageReaction[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const emoji = typeof entry.emoji === "string" ? entry.emoji.trim() : "";
    const by = typeof entry.by === "string" ? entry.by.trim() : "";
    if (!emoji || !by || seen.has(by)) continue;
    seen.add(by);
    reactions.push({ emoji, by, at: typeof entry.at === "string" ? entry.at : "" });
  }
  return reactions;
}

function parseExtra(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Sets, replaces or (with `emoji: null`) removes one reactor's reaction. Picking the emoji the reactor already
 * has removes it, the way tapping a tapback again does.
 */
export function withMessageReaction(
  reactions: readonly MessageReaction[],
  by: string,
  emoji: string | null,
  at: string,
): MessageReaction[] {
  const current = reactions.find((reaction) => reaction.by === by);
  const others = reactions.filter((reaction) => reaction.by !== by);
  if (!emoji || current?.emoji === emoji) return others;
  return [...others, { emoji, by, at }];
}

/**
 * The note added after a reacted message in the prompt history, e.g. "(Sam reacted ❤️)". Returns "" when nobody
 * reacted.
 */
export function reactionHistoryNote(
  reactions: readonly MessageReaction[],
  reactorName: (by: string) => string,
): string {
  if (reactions.length === 0) return "";
  return `(${reactions.map((reaction) => `${reactorName(reaction.by)} reacted ${reaction.emoji}`).join(", ")})`;
}

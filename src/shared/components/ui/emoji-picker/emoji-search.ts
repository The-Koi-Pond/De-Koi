import { EMOJI_CATEGORIES } from "./emoji-categories";
import { EMOJI_KEYWORDS } from "./emoji-keywords";

export interface EmojiSection {
  label: string;
  emojis: readonly string[];
}

/** The emoji's name: the first phrase of its keyword text. */
export function emojiName(emoji: string): string {
  return EMOJI_KEYWORDS[emoji].split(",")[0].trim();
}

/** The search box text as the picker matches it: trimmed and lowercased. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Every category with a match for a non-empty query, in category order, each with its matching emojis
 * in category order. An emoji matches when the query appears anywhere in its keyword text.
 */
export function searchEmojis(query: string): EmojiSection[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  return EMOJI_CATEGORIES.map((category) => ({
    label: category.label,
    emojis: category.emojis.filter((emoji) => EMOJI_KEYWORDS[emoji].includes(needle)),
  })).filter((section) => section.emojis.length > 0);
}

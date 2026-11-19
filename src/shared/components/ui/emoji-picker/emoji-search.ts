import { EMOJI_CATEGORIES } from "./emoji-categories";
import { EMOJI_KEYWORDS } from "./emoji-keywords";

export interface EmojiSection {
  label: string;
  emojis: readonly string[];
}

/** Each emoji's keyword phrases, split once. Matching runs per phrase, never across a comma. */
const PHRASES: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(EMOJI_KEYWORDS).map(([emoji, text]) => [emoji, text.split(",").map((phrase) => phrase.trim())]),
);

function phrasesOf(emoji: string): readonly string[] {
  const phrases = PHRASES.get(emoji);
  if (!phrases) throw new Error(`No keywords for emoji ${emoji}`);
  return phrases;
}

/** The emoji's name: its first keyword phrase. */
export function emojiName(emoji: string): string {
  return phrasesOf(emoji)[0];
}

/** The search box text as the picker matches it: trimmed and lowercased. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Every category with a match for a non-empty query, in category order, each with its matching emojis
 * in category order. An emoji matches when the query appears anywhere inside one of its keyword phrases.
 */
export function searchEmojis(query: string): EmojiSection[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  return EMOJI_CATEGORIES.map((category) => ({
    label: category.label,
    emojis: category.emojis.filter((emoji) => phrasesOf(emoji).some((phrase) => phrase.includes(needle))),
  })).filter((section) => section.emojis.length > 0);
}

import { ALL_EXPRESSIONS, ALL_POSES, type SpriteType } from "./sprite-lists";

const FULL_BODY_PREFIX = "full_";

/**
 * The rename rule: trimmed, lowercased, and every character other than `a`–`z`, `0`–`9`, `_` and `-` turned into `_`.
 * Rust applies the same rule again when it writes the file.
 */
export function normalizeSpriteName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function withoutFullBodyPrefix(name: string): string {
  return name.startsWith(FULL_BODY_PREFIX) ? name.slice(FULL_BODY_PREFIX.length) : name;
}

/** A name as the name list shows it: the rename rule, then a leading `full_` removed. */
export function listFormName(name: string): string {
  return withoutFullBodyPrefix(normalizeSpriteName(name));
}

/**
 * The name a sprite is saved under. The Sprites tabs, the roleplay sprite display and image references tell
 * portraits and full-body sprites apart by the `full_` prefix, so full-body names get it once and portrait names never
 * keep it.
 */
export function saveSpriteName(name: string, type: SpriteType): string {
  const normalized = normalizeSpriteName(name);
  if (type === "full-body") {
    return normalized.startsWith(FULL_BODY_PREFIX) ? normalized : `${FULL_BODY_PREFIX}${normalized}`;
  }
  return withoutFullBodyPrefix(normalized);
}

/**
 * The save name when the sprite can be saved, or null when it has no name: an empty name, or one that the save rule
 * empties (`full_` on Expressions). Save, its count and the "Needs a name" mark all use this.
 */
export function savableName(name: string, type: SpriteType): string | null {
  if (name.trim() === "") return null;
  const saveName = saveSpriteName(name, type);
  return saveName === "" ? null : saveName;
}

/**
 * The save names that would replace a sprite the owner already has (saving writes over a saved sprite with the same
 * name), in save order and each once.
 */
export function namesReplacingSaved(saveNames: readonly string[], savedNames: readonly string[]): string[] {
  const saved = new Set(savedNames.map((name) => name.toLowerCase()));
  return [...new Set(saveNames)].filter((name) => name !== "" && saved.has(name.toLowerCase()));
}

/** "Replace 2 saved sprites: happy, sad?", listing at most six names. */
export function replaceSavedQuestion(names: readonly string[]): string {
  const shown = names.slice(0, 6).join(", ");
  const more = names.length > 6 ? ` and ${names.length - 6} more` : "";
  return `Replace ${names.length} saved sprite${names.length === 1 ? "" : "s"}: ${shown}${more}?`;
}

export const MAX_MATCHED_NAMES = 16;

/**
 * The owner's portrait names, ready to be matched by full-body sprites: each in list form, empty names and repeats
 * dropped, first seen kept, in the given order. All of them; the dialog uses the first {@link MAX_MATCHED_NAMES}.
 */
export function matchedExpressionNames(existingNames: readonly string[]): string[] {
  const names: string[] = [];
  for (const name of existingNames) {
    const cleaned = listFormName(name);
    if (cleaned && !names.includes(cleaned)) names.push(cleaned);
  }
  return names;
}

/** Which full list the name list offers after the generation's own names. */
export type NameListKind = "expressions" | "poses";

/** The name list's options: the generation's names, then every expression or pose, in list form, without repeats. */
export function nameOptions(generationNames: readonly string[], kind: NameListKind): string[] {
  const options: string[] = [];
  const all = kind === "poses" ? ALL_POSES : ALL_EXPRESSIONS;
  for (const name of [...generationNames, ...all]) {
    const option = listFormName(name);
    if (option && !options.includes(option)) options.push(option);
  }
  return options;
}

/** One sprite's own options: its list form goes on top when the shared options don't have it. */
export function spriteNameOptions(name: string, sharedOptions: readonly string[]): string[] {
  const own = listFormName(name);
  return sharedOptions.includes(own) ? [...sharedOptions] : [own, ...sharedOptions];
}

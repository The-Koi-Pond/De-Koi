import { characterAvatarUrl } from "../../../../catalog/characters/index";
import { parseCharacterDisplayData } from "../../../../../shared/lib/character-display";

export type DrawerCharacter = {
  id: string;
  data?: unknown;
  comment?: string | null;
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
};

export function mergeDrawerCharacters(
  ...sources: Array<Array<DrawerCharacter | undefined> | null | undefined>
): DrawerCharacter[] {
  const byId = new Map<string, DrawerCharacter>();
  for (const source of sources) {
    for (const character of source ?? []) {
      if (!character?.id) continue;
      byId.set(character.id, {
        ...character,
        avatarPath: characterAvatarUrl(character),
      });
    }
  }
  return Array.from(byId.values());
}

export function characterSearchValues(character: {
  id?: string;
  data?: unknown;
  comment?: string | null;
}): string[] {
  const info = parseCharacterDisplayData({ data: character.data, comment: character.comment });
  const data =
    character.data && typeof character.data === "object" ? (character.data as Record<string, unknown>) : {};
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  return [
    character.id,
    info.name,
    info.comment,
    data.creator,
    data.creator_notes,
    data.character_version,
    ...tags,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function splitSearchTerms(value: string): string[] {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function searchValuesMatchTerms(values: string[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  return terms.every((term) => values.some((value) => value.includes(term)));
}

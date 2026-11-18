import { characterAvatarUrl, estimateCharacterCardTokens } from "../../../../../catalog/characters/index";
import {
  getInlineCardTokenWarning,
  type InlineCardTokenWarning,
} from "../../../../../catalog/lib/card-token-recommendation";
import { getCharacterTitle, parseCharacterDisplayData } from "../../../../../../shared/lib/character-display";
import { characterSearchValues, searchValuesMatchTerms } from "../../lib/chat-settings-character-search";

/** One character as setup shows it in its lists, chips and rows. */
export interface SetupCharacter {
  id: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  avatarFilePath: string | null;
  avatarFilename: string | null;
  avatarCrop: unknown;
  tokenWarning: InlineCardTokenWarning | null;
  /** Lowercase text a search matches: id, name, title, creator, creator notes, version and tags. */
  searchValues: string[];
}

type CharacterRecord = {
  id: string;
  data?: unknown;
  comment?: string | null;
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
};

function cardData(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toSetupCharacter(record: CharacterRecord): SetupCharacter {
  const data = cardData(record.data);
  const display = parseCharacterDisplayData({ data, comment: record.comment });
  const extensions = cardData(data.extensions);
  return {
    id: record.id,
    name: display.name,
    title: getCharacterTitle(display),
    avatarUrl: characterAvatarUrl(record),
    avatarFilePath: record.avatarFilePath ?? null,
    avatarFilename: record.avatarFilename ?? null,
    avatarCrop: extensions.avatarCrop,
    tokenWarning: getInlineCardTokenWarning(estimateCharacterCardTokens(data)),
    searchValues: characterSearchValues({ id: record.id, data, comment: record.comment }).map((value) =>
      value.toLowerCase(),
    ),
  };
}

/** A character setup knows only by name so far, such as one just created from the empty state. */
export function namedSetupCharacter(id: string, name: string): SetupCharacter {
  return {
    id,
    name,
    title: null,
    avatarUrl: null,
    avatarFilePath: null,
    avatarFilename: null,
    avatarCrop: undefined,
    tokenWarning: null,
    searchValues: [id.toLowerCase(), name.toLowerCase()],
  };
}

/** Every word of the search (any case) has to appear in one of the character's search values. */
export function characterMatchesSearch(character: SetupCharacter, terms: readonly string[]): boolean {
  return searchValuesMatchTerms(character.searchValues, [...terms]);
}

/** The full card's greeting: its first message and the non-empty alternate greetings. */
export function readCardGreeting(card: unknown): { firstMessage: string; alternates: string[] } | null {
  const record = cardData(card);
  const data = cardData(record.data);
  const firstMessage = typeof data.first_mes === "string" ? data.first_mes : "";
  if (!firstMessage.trim()) return null;
  const alternates = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return { firstMessage, alternates };
}

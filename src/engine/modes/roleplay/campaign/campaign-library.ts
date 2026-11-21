// The player's own characters and lorebooks a campaign is built around: read from the library, turned into prompt
// text, and found by name for requests that only name them (Deki-senpai's card).
import type { StorageGateway } from "../../../capabilities/storage";
import { boolish, isRecord, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { userFacingError } from "../../../shared/user-facing-error";

const MAX_PICKS = 6;
const CHARACTER_CHARS = 3_500;
const FIELD_CHARS = 1_400;
const LOREBOOK_CHARS = 8_000;
const ENTRY_CHARS = 700;

interface LibraryCharacter {
  id: string;
  name: string;
  /** Their card, compacted for the planning prompts. */
  card: string;
}

interface LibraryLorebook {
  id: string;
  name: string;
  /** Its enabled entries, compacted for the planning prompts. */
  text: string;
}

export interface CampaignLibrary {
  characters: LibraryCharacter[];
  lorebooks: LibraryLorebook[];
}


function clip(value: string, max: number): string {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_PICKS);
}

function cardText(record: JsonRecord): { name: string; card: string } {
  const data = Object.keys(parseRecord(record.data)).length > 0 ? parseRecord(record.data) : record;
  const extensions = parseRecord(data.extensions);
  const name = readString(data.name).trim() || readString(record.name).trim() || "Unnamed";
  const parts: Array<[string, unknown]> = [
    ["Description", data.description],
    ["Appearance", extensions.appearance],
    ["Personality", data.personality],
    ["Backstory", extensions.backstory],
    ["Scenario", data.scenario],
    ["How they talk (examples)", data.mes_example],
  ];
  const card = parts
    .map(([label, value]) => [label, clip(readString(value), FIELD_CHARS)] as const)
    .filter(([, value]) => value.length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
  return { name, card: clip(card.replaceAll("{{char}}", name), CHARACTER_CHARS) };
}

function lorebookText(entries: readonly JsonRecord[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    if (!boolish(entry.enabled, true)) continue;
    const content = clip(readString(entry.content), ENTRY_CHARS);
    if (!content) continue;
    const line = `- ${readString(entry.name).trim() || "Entry"}: ${content}`;
    if (used + line.length > LOREBOOK_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** Reads the picked characters and lorebooks. A pick that no longer exists fails with its name, not silently. */
export async function loadCampaignLibrary(
  storage: StorageGateway,
  picks: { characterIds?: readonly string[]; lorebookIds?: readonly string[] },
): Promise<CampaignLibrary> {
  const characters = await Promise.all(
    uniqueIds(picks.characterIds ?? []).map(async (id) => {
      const row = await storage.get<unknown>("characters", id);
      if (!isRecord(row)) throw userFacingError("One of the picked characters no longer exists. Pick again.");
      return { id, ...cardText(row) };
    }),
  );
  const lorebooks = await Promise.all(
    uniqueIds(picks.lorebookIds ?? []).map(async (id) => {
      const row = await storage.get<unknown>("lorebooks", id);
      if (!isRecord(row)) throw userFacingError("One of the picked lorebooks no longer exists. Pick again.");
      const entries = (await storage.listLorebookEntries<unknown>(id)).filter(isRecord);
      return { id, name: readString(row.name).trim() || "Untitled lorebook", text: lorebookText(entries) };
    }),
  );
  return { characters, lorebooks };
}

/** The planning prompts' section on the player's own material; empty when there is none. */
export function libraryPromptLines(library: CampaignLibrary): string[] {
  const lines: string[] = [];
  if (library.characters.length > 0) {
    lines.push(
      "",
      "The player's own characters. They asked for these exact characters: use them as written, with the same names, looks, voices, personalities and histories. Put each one in the cast under the same name, make them central, and build the plot around who they already are. Add new cast only around them.",
      ...library.characters.map((character) => `### ${character.name}\n${character.card}`),
    );
  }
  if (library.lorebooks.length > 0) {
    lines.push(
      "",
      "The player's world, from their own lorebooks. Set the campaign in this world and never contradict it; reuse its places, groups and facts instead of inventing replacements.",
      ...library.lorebooks.map((lorebook) => `### ${lorebook.name}\n${lorebook.text || "(no entries)"}`),
    );
  }
  return lines;
}

function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Library rows whose name matches one of `names` (case and punctuation ignored; an exact name wins over a name that
 * only starts the same way). Names that match nothing come back in `missing`.
 */
export function matchLibraryNames(
  rows: ReadonlyArray<{ id: string; name: string }>,
  names: readonly string[],
): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const wanted = normalizedName(name);
    if (!wanted) continue;
    const exact = rows.find((row) => normalizedName(row.name) === wanted);
    const prefix = exact ?? rows.find((row) => normalizedName(row.name).startsWith(`${wanted} `));
    if (prefix) {
      if (!ids.includes(prefix.id)) ids.push(prefix.id);
    } else {
      missing.push(name);
    }
  }
  return { ids: ids.slice(0, MAX_PICKS), missing };
}

/** Finds the named characters and lorebooks in the library, for requests that only name them. */
export async function findLibraryPicks(
  storage: StorageGateway,
  names: { characters: readonly string[]; lorebooks: readonly string[] },
): Promise<{ characterIds: string[]; lorebookIds: string[]; missing: string[] }> {
  const rowsOf = async (entity: "characters" | "lorebooks") =>
    (await storage.list<unknown>(entity))
      .filter(isRecord)
      .map((row) => ({
        id: readString(row.id).trim(),
        name: readString(parseRecord(row.data).name).trim() || readString(row.name).trim(),
      }))
      .filter((row) => row.id && row.name);
  const [characters, lorebooks] = await Promise.all([
    names.characters.length > 0 ? rowsOf("characters") : [],
    names.lorebooks.length > 0 ? rowsOf("lorebooks") : [],
  ]);
  const characterMatch = matchLibraryNames(characters, names.characters);
  const lorebookMatch = matchLibraryNames(lorebooks, names.lorebooks);
  return {
    characterIds: characterMatch.ids,
    lorebookIds: lorebookMatch.ids,
    missing: [...characterMatch.missing, ...lorebookMatch.missing],
  };
}

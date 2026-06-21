export interface TrackerPersonaIdentity {
  personaId?: unknown;
  id?: unknown;
  name?: unknown;
}

export interface PresentCharacterIdentity {
  characterId?: unknown;
  characterIds?: unknown;
  name?: unknown;
}

const PLAYER_PERSONA_MACROS = new Set(["{{user}}", "{{username}}"]);

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentity(value: unknown): string {
  return readText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeMacroIdentity(value: unknown): string {
  return normalizeIdentity(value).replace(/\s+/g, "");
}

function readTextList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? parsed.map(readText).filter(Boolean)
        : [readText(parsed)].filter(Boolean);
    } catch {
      return [trimmed];
    }
  }
  return Array.isArray(value) ? value.map(readText).filter(Boolean) : [];
}

function rowIdentities(row: PresentCharacterIdentity): string[] {
  return [readText(row.characterId), ...readTextList(row.characterIds), readText(row.name)].filter(Boolean);
}

function personaIdentities(persona?: TrackerPersonaIdentity | null): string[] {
  if (!persona) return [];
  return [readText(persona.personaId ?? persona.id), readText(persona.name)].filter(Boolean);
}

function isPlayerPersonaPresentCharacter(
  row: PresentCharacterIdentity,
  persona?: TrackerPersonaIdentity | null,
): boolean {
  const identities = rowIdentities(row);
  if (identities.some((identity) => PLAYER_PERSONA_MACROS.has(normalizeMacroIdentity(identity)))) return true;

  const personaIdentitySet = new Set(personaIdentities(persona).map(normalizeIdentity).filter(Boolean));
  return identities.some((identity) => personaIdentitySet.has(normalizeIdentity(identity)));
}

export function filterPlayerPersonaPresentCharacters<T extends PresentCharacterIdentity>(
  rows: readonly T[],
  persona?: TrackerPersonaIdentity | null,
): T[] {
  return rows.filter((row) => !isPlayerPersonaPresentCharacter(row, persona));
}

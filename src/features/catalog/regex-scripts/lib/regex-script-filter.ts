export type RegexScriptScope = {
  characterId?: string | null;
  targetCharacterIds?: unknown;
};

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return stringArray(parsed);
  } catch {
    return [trimmed];
  }
}

export function regexScriptTargetCharacterIds(script: RegexScriptScope): string[] {
  const targetCharacterIds = stringArray(script.targetCharacterIds);
  if (targetCharacterIds.length > 0) return Array.from(new Set(targetCharacterIds));
  const characterId = typeof script.characterId === "string" ? script.characterId.trim() : "";
  return characterId ? [characterId] : [];
}

export function isRegexScriptScoped(script: RegexScriptScope): boolean {
  return regexScriptTargetCharacterIds(script).length > 0;
}

export function filterRegexScriptsByCharacterIds<T extends RegexScriptScope>(
  scripts: T[],
  characterIds?: string[],
): T[] {
  if (!characterIds) return scripts;
  const idSet = new Set(characterIds);
  return scripts.filter((script) => {
    const targetIds = regexScriptTargetCharacterIds(script);
    return targetIds.length === 0 || targetIds.some((id) => idSet.has(id));
  });
}

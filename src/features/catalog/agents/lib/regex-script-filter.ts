export type RegexScriptScope = {
  characterId?: string | null;
};

export function filterRegexScriptsByCharacterIds<T extends RegexScriptScope>(
  scripts: T[],
  characterIds?: string[],
): T[] {
  if (!characterIds) return scripts;
  const idSet = new Set(characterIds);
  return scripts.filter((script) => !script.characterId || idSet.has(script.characterId));
}

type MergedGroupCharacter = {
  name?: string | null;
};

export function mergedGroupNames(
  characterIds: readonly string[] | null | undefined,
  characterMap: ReadonlyMap<string, MergedGroupCharacter | null | undefined> | null | undefined,
): string[] {
  if (!characterIds?.length || !characterMap) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const characterId of characterIds) {
    const name = characterMap.get(characterId)?.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function mergedGroupDisplayLabel(names: readonly string[]): string {
  const cleanNames = names.map((name) => name.trim()).filter(Boolean);
  if (cleanNames.length === 0) return "Group";
  if (cleanNames.length <= 3) return cleanNames.join(", ");
  return `${cleanNames.slice(0, 3).join(", ")} +${cleanNames.length - 3}`;
}

export type CharacterSelectionItem = {
  id: string;
};

export function toggleCharacterLibrarySelection(current: ReadonlySet<string>, characterId: string): Set<string> {
  const next = new Set(current);
  if (next.has(characterId)) {
    next.delete(characterId);
  } else {
    next.add(characterId);
  }
  return next;
}

export function selectVisibleCharacterIds(characters: readonly CharacterSelectionItem[]): Set<string> {
  return new Set(characters.map((character) => character.id));
}

export function characterLibrarySelectionLabel(selectedCount: number): string {
  return `${selectedCount} selected`;
}

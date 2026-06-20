export function nextRegexScriptTargetCharacterIds(currentTargetIds: string[], characterId: string): string[] {
  return currentTargetIds.includes(characterId)
    ? currentTargetIds.filter((id) => id !== characterId)
    : [...currentTargetIds, characterId];
}

export function savedRegexScriptPromptOnly(targetCharacterIds: string[], globalPromptOnly: boolean): boolean {
  return targetCharacterIds.length > 0 || globalPromptOnly;
}

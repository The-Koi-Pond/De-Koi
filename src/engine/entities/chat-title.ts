const MODE_FALLBACK_TITLES: Record<string, string> = {
  conversation: "New Conversation",
  roleplay: "New Roleplay",
  game: "New Game",
};

export function deriveChatTitle(mode: string | null | undefined, names: readonly string[]): string {
  const seen = new Set<string>();
  const normalizedNames: string[] = [];

  for (const name of names) {
    const normalized = name.trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    normalizedNames.push(normalized);
  }

  if (normalizedNames.length > 0) return normalizedNames.join(", ");
  return MODE_FALLBACK_TITLES[mode?.trim().toLocaleLowerCase() ?? ""] ?? "New Chat";
}

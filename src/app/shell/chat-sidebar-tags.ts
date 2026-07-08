export function normalizeChatTagsDraft(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of value.split(/[,.\n]/)) {
    const tag = rawTag.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function formatChatTagsDraft(tags: readonly string[]): string {
  return tags.join(", ");
}

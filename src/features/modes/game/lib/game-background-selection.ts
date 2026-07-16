const BACKGROUND_FALLBACK_IGNORED_WORDS = new Set(["background", "backgrounds", "generated", "user"]);
const BACKGROUND_FALLBACK_HINT = /default|start|town|village|forest|field|room|interior|corridor|hall|night|day/i;

export function backgroundTagScore(requested: string, candidate: string): number {
  const words = requested
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !BACKGROUND_FALLBACK_IGNORED_WORDS.has(word));
  const parts = candidate
    .toLowerCase()
    .split(/[:_-]+/)
    .filter((part) => part.length > 1);

  let score = 0;
  for (const word of words) {
    for (const part of parts) {
      if (part.includes(word) || word.includes(part)) {
        score += word.length;
        break;
      }
    }
  }
  return score;
}

export function pickFallbackBackgroundTag(
  requested: string | undefined | null,
  manifest: Record<string, { path: string }> | null,
): string | null {
  const tags = Object.keys(manifest ?? {}).filter(
    (tag) => tag.startsWith("backgrounds:") && !tag.startsWith("backgrounds:illustrations:"),
  );
  if (tags.length === 0) return null;

  const cleaned = requested?.trim() ?? "";
  if (cleaned) {
    let bestTag: string | null = null;
    let bestScore = 0;
    for (const tag of tags) {
      const score = backgroundTagScore(cleaned, tag);
      if (score > bestScore) {
        bestScore = score;
        bestTag = tag;
      }
    }
    if (bestTag && bestScore > 0) return bestTag;
  }

  return tags.find((tag) => BACKGROUND_FALLBACK_HINT.test(tag)) ?? tags[0]!;
}

export function backgroundOptionKey(tag: string): string {
  let slug = tag
    .trim()
    .toLowerCase()
    .replace(/:/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixPattern = /^(?:backgrounds|fantasy|modern|scifi|user|generated|illustrations|q-[a-z0-9]{6,})-+/;
  while (prefixPattern.test(slug)) {
    slug = slug.replace(prefixPattern, "");
  }
  return slug || tag.trim().toLowerCase();
}

export function getSceneBackgroundTags(assetKeys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of assetKeys) {
    if (!key.startsWith("backgrounds:") || key.startsWith("backgrounds:illustrations:")) continue;
    const dedupeKey = backgroundOptionKey(key);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(key);
  }
  return result;
}

/**
 * Tag filters shared by the lists that filter by tag (Characters, Personas, Lorebooks, the chat list).
 * Clicking a tag cycles it: off → include → exclude → off. An item shows when it has any included tag
 * (or no tag is included) and none of the excluded ones. Tags match regardless of upper/lower case.
 */
export type TagFilterMode = "include" | "exclude";

/** Each filtered tag and how; tags that aren't in it are off. */
export type TagFilters = Readonly<Record<string, TagFilterMode>>;

export const NO_TAG_FILTERS: TagFilters = Object.freeze({});

/** The tag's next state when clicked: off → include → exclude → off. */
export function cycleTagFilter(filters: TagFilters, tag: string): TagFilters {
  const next: Record<string, TagFilterMode> = { ...filters };
  const current = filters[tag];
  if (current === undefined) next[tag] = "include";
  else if (current === "include") next[tag] = "exclude";
  else delete next[tag];
  return next;
}

/** The filters without this tag (for a tag that was deleted). */
export function withoutTagFilter(filters: TagFilters, tag: string): TagFilters {
  if (!(tag in filters)) return filters;
  const next: Record<string, TagFilterMode> = { ...filters };
  delete next[tag];
  return next;
}

/** The filters limited to tags that still exist, so a filter on a vanished tag can't hide everything. */
export function keepExistingTagFilters(filters: TagFilters, existingTags: readonly string[]): TagFilters {
  const existing = new Set(existingTags);
  const stale = Object.keys(filters).filter((tag) => !existing.has(tag));
  if (stale.length === 0) return filters;
  const next: Record<string, TagFilterMode> = { ...filters };
  for (const tag of stale) delete next[tag];
  return next;
}

export function countTagFilters(filters: TagFilters): { included: number; excluded: number } {
  let included = 0;
  let excluded = 0;
  for (const mode of Object.values(filters)) {
    if (mode === "include") included += 1;
    else excluded += 1;
  }
  return { included, excluded };
}

export function hasTagFilters(filters: TagFilters): boolean {
  return Object.keys(filters).length > 0;
}

/** Whether an item with these tags passes the filters. */
export function matchesTagFilters(tags: readonly string[], filters: TagFilters): boolean {
  const entries = Object.entries(filters);
  if (entries.length === 0) return true;
  const itemTags = new Set(tags.map((tag) => tag.toLowerCase()));
  let hasInclude = false;
  let includedMatch = false;
  for (const [tag, mode] of entries) {
    const present = itemTags.has(tag.toLowerCase());
    if (mode === "exclude") {
      if (present) return false;
    } else {
      hasInclude = true;
      if (present) includedMatch = true;
    }
  }
  return !hasInclude || includedMatch;
}

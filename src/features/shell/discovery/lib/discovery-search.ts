import type { DiscoveryCategory, DiscoveryCoverage, DiscoveryEntry } from "../discovery-types";

export interface DiscoveryFilters {
  category: DiscoveryCategory | "All";
  coverage: DiscoveryCoverage | "All";
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function scoreDiscoveryEntry(entry: DiscoveryEntry, query: string) {
  const normalizedQuery = normalize(query);
  const terms = normalizedQuery.split(" ").filter(Boolean);
  if (terms.length === 0) return 0;

  const title = normalize(entry.title);
  const keywords = entry.keywords.map(normalize);
  const descriptiveText = normalize([entry.category, entry.summary, entry.audience, entry.where, entry.coverage].join(" "));
  let score = title === normalizedQuery ? 1_000 : title.startsWith(normalizedQuery) ? 700 : 0;

  for (const term of terms) {
    if (title.includes(term)) score += 500;
    else if (keywords.some((keyword) => keyword.includes(term))) score += 300;
    else if (descriptiveText.includes(term)) score += 100;
    else return null;
  }

  if (entry.coverage === "core") score += 2;
  else if (entry.coverage === "advanced") score += 1;
  return score;
}

function searchDiscoveryEntries(entries: readonly DiscoveryEntry[], query: string) {
  if (!normalize(query)) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index, score: scoreDiscoveryEntry(entry, query) }))
    .filter((result): result is { entry: DiscoveryEntry; index: number; score: number } => result.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ entry }) => entry);
}

export function filterDiscoveryEntries(
  entries: readonly DiscoveryEntry[],
  query: string,
  filters: DiscoveryFilters,
) {
  return searchDiscoveryEntries(entries, query).filter((entry) => {
    if (filters.category !== "All" && entry.category !== filters.category) return false;
    if (filters.coverage !== "All" && entry.coverage !== filters.coverage) return false;
    return true;
  });
}

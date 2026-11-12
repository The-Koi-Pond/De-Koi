import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import {
  resolveActiveLorebookScopeReasons,
  type ActiveLorebookScopeContext,
} from "../../../../../engine/generation-core/lorebooks/active-lorebook-scope";
import { matchesTagFilters, type TagFilters } from "../../../lib/tag-filters";

export type LorebookPanelSort = "name-asc" | "name-desc" | "newest" | "oldest" | "tokens";

/** "All" lorebooks, or only the ones the active chat uses. */
export type LorebookPanelActiveFilter = "all" | "active";

/** A token budget as "800" or "1.2k", for the row's meta line. */
export function formatLorebookTokenBudget(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function readTagArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function readParsedTagArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === "string") ? value : [];
}

export function parseLorebookTags(lorebook: Pick<Lorebook, "tags">): string[] {
  const raw = lorebook.tags;
  if (Array.isArray(raw)) return readTagArray(raw);
  if (typeof raw === "string")
    try {
      return readParsedTagArray(JSON.parse(raw));
    } catch {
      return [];
    }
  return [];
}

export function collectLorebookTags(lorebooks: readonly Lorebook[]): string[] {
  const tagSet = new Set<string>();
  for (const lorebook of lorebooks) {
    for (const tag of parseLorebookTags(lorebook)) tagSet.add(tag);
  }
  return Array.from(tagSet).sort();
}

export function filterLorebooksForPanel({
  lorebooks,
  activeFilter,
  activeScopeContext,
  typeFilters,
  tagFilters,
  searchQuery,
  getCharacterNames,
  getPersonaNames,
}: {
  lorebooks: readonly Lorebook[];
  activeFilter: LorebookPanelActiveFilter;
  activeScopeContext: ActiveLorebookScopeContext;
  /** Included and excluded types, keyed by category id ("uncategorized" for Other). */
  typeFilters: TagFilters;
  /** Included and excluded tags (see `matchesTagFilters`). */
  tagFilters: TagFilters;
  searchQuery: string;
  getCharacterNames: (lorebook: Lorebook) => string[];
  getPersonaNames: (lorebook: Lorebook) => string[];
}): Lorebook[] {
  let list = [...lorebooks];
  if (activeFilter === "active") {
    list = list.filter((lorebook) => resolveActiveLorebookScopeReasons(lorebook, activeScopeContext).length > 0);
  }
  list = list.filter((lorebook) => matchesTagFilters([lorebook.category || "uncategorized"], typeFilters));
  list = list.filter((lorebook) => matchesTagFilters(parseLorebookTags(lorebook), tagFilters));
  if (!searchQuery) return list;

  const query = searchQuery.toLowerCase();
  return list.filter(
    (lorebook) =>
      lorebook.name.toLowerCase().includes(query) ||
      lorebook.description.toLowerCase().includes(query) ||
      getCharacterNames(lorebook).some((name) => name.toLowerCase().includes(query)) ||
      getPersonaNames(lorebook).some((name) => name.toLowerCase().includes(query)) ||
      parseLorebookTags(lorebook).some((tag) => tag.toLowerCase().includes(query)),
  );
}

export function sortLorebooksForPanel(lorebooks: readonly Lorebook[], sort: LorebookPanelSort): Lorebook[] {
  const list = [...lorebooks];
  switch (sort) {
    case "name-asc":
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return list.sort((a, b) => b.name.localeCompare(a.name));
    case "newest":
      return list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    case "oldest":
      return list.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    case "tokens":
      return list.sort((a, b) => (b.tokenBudget ?? 0) - (a.tokenBudget ?? 0));
  }
}

export function groupLorebooksByCategory(lorebooks: readonly Lorebook[]): Map<string, Lorebook[]> {
  const map = new Map<string, Lorebook[]>();
  for (const lorebook of lorebooks) {
    const category = lorebook.category || "uncategorized";
    const list = map.get(category) ?? [];
    list.push(lorebook);
    map.set(category, list);
  }
  return map;
}

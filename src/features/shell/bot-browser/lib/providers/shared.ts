import { isRecord } from "../../../../../engine/shared/value-readers";
import type { BrowserCard, CardStat, CharacterDetail, SearchCriteria } from "./types";

/** A URL query as form values (spaces as `+`), keeping the order the pairs were added in. */
export function formQuery(pairs: Array<[string, string]>): string {
  return new URLSearchParams(pairs).toString();
}

export function hasSearchText(criteria: Pick<SearchCriteria, "search">): boolean {
  return criteria.search.trim().length > 0;
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

export function first200(value: string): string {
  return value.slice(0, 200);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A string field, or undefined when it's missing or empty. */
export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function greetingsWithoutEmpty(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** The first segment of a `creator/slug` path. */
export function firstSegment(path: string): string {
  return path.split("/")[0] ?? "";
}

/** A picture source for avatar routes that take a full URL encoded and a site path as is. */
export function encodedWhenUrl(src: string): string {
  return src.startsWith("http") ? encodeURIComponent(src) : src;
}

export function comma(values: string[]): string {
  return values.join(",");
}

/** Leaves out excluded tags (any case). */
export function withoutExcludedTags<T>(items: T[], tagsOf: (item: T) => string[], excludeTags: string[]): T[] {
  if (excludeTags.length === 0) return items;
  const excluded = new Set(excludeTags.map((tag) => tag.toLowerCase()));
  return items.filter((item) => !tagsOf(item).some((tag) => excluded.has(tag.toLowerCase())));
}

type CardInput = Omit<BrowserCard, "stats" | "name"> & {
  name: string;
  stats: Array<Omit<CardStat, "value"> & { value: unknown }>;
};

/** A card with "Unnamed" for an empty name and only the stats worth showing (a number above 0 with a label). */
export function makeCard(input: CardInput): BrowserCard {
  const stats: CardStat[] = [];
  for (const stat of input.stats) {
    const value = numberOr0(stat.value);
    if (value > 0 && stat.label) stats.push({ value, label: stat.label, icon: stat.icon });
  }
  return { ...input, name: input.name || "Unnamed", stats };
}

const TEXT_FIELDS = [
  "description",
  "personality",
  "scenario",
  "firstMessage",
  "exampleDialogs",
  "creatorNotes",
  "systemPrompt",
  "postHistoryInstructions",
  "characterVersion",
] as const;

/**
 * Drops empty text fields and returns null when nothing usable is left: no text, no greetings, no lorebook and no
 * provider extensions.
 */
export function usableDetail(detail: CharacterDetail): CharacterDetail | null {
  const result: CharacterDetail = {};
  let usable = false;
  for (const field of TEXT_FIELDS) {
    const value = detail[field];
    if (typeof value === "string" && value !== "") {
      result[field] = value;
      usable = true;
    }
  }
  if (detail.alternateGreetings) {
    result.alternateGreetings = detail.alternateGreetings;
    if (detail.alternateGreetings.length > 0) usable = true;
  }
  if (isRecord(detail.providerExtensions)) {
    result.providerExtensions = detail.providerExtensions;
    if (Object.keys(detail.providerExtensions).length > 0) usable = true;
  }
  if (detail.embeddedLorebook !== undefined && detail.embeddedLorebook !== null) {
    result.embeddedLorebook = detail.embeddedLorebook;
    usable = true;
  }
  if (detail.hasLorebook) {
    result.hasLorebook = true;
    usable = true;
  }
  return usable ? result : null;
}

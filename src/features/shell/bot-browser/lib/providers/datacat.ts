import { isRecord } from "../../../../../engine/shared/value-readers";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import type {
  DatacatCharacter,
  DatacatCharacterResponse,
  DatacatCharacterTag,
  DatacatDownloadResponse,
  DatacatFreshResponse,
  DatacatRecentResponse,
  DatacatTagRecord,
  DatacatTagsResponse,
} from "../../types/provider-responses";
import { proxyImageSource, siteGet } from "../site-api";
import {
  comma,
  encodedWhenUrl,
  first200,
  formQuery,
  greetingsWithoutEmpty,
  hasSearchText,
  makeCard,
  optionalText,
  stripHtml,
  text,
  usableDetail,
  withoutExcludedTags,
} from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 80;
const POPULAR_TAG_COUNT = 150;
const DATACAT_FRESH_PATH = "datacat/fresh?sortBy=score&limit24=80&limitWeek=0";
const FRESH_FALLBACK_NOTICE = "DataCat Fresh is using recent-public results while the weekly window is unavailable.";

interface DatacatTags {
  idsByName: Map<string, number>;
  namesById: Map<number, string>;
  popular: string[];
}

// Loaded once per app session, before the first DataCat search. A failed load isn't kept, so the next search tries
// again.
let loadedTags: DatacatTags | null = null;
let pendingTags: Promise<DatacatTags> | null = null;

function tagRecords(reply: DatacatTagsResponse | null | undefined): DatacatTagRecord[] {
  if (Array.isArray(reply)) return reply;
  if (isRecord(reply)) {
    if (Array.isArray(reply.tags)) return reply.tags;
    if (Array.isArray(reply.facets)) return reply.facets;
  }
  return [];
}

function recordId(record: DatacatTagRecord): number | undefined {
  const id = record.id ?? record.tag_id ?? record.tagId;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

function readTags(reply: DatacatTagsResponse | null | undefined): DatacatTags {
  const idsByName = new Map<string, number>();
  const namesById = new Map<number, string>();
  const counted: Array<{ name: string; count: number }> = [];
  for (const record of tagRecords(reply)) {
    if (!isRecord(record)) continue;
    const id = recordId(record);
    const name = text(record.name) || text(record.slug);
    if (id === undefined || !name) continue;
    idsByName.set(name.toLowerCase(), id);
    namesById.set(id, name);
    counted.push({ name, count: typeof record.count === "number" ? record.count : 0 });
  }
  const popular = counted
    .sort((left, right) => right.count - left.count)
    .slice(0, POPULAR_TAG_COUNT)
    .map((entry) => entry.name);
  return { idsByName, namesById, popular };
}

function loadDatacatTags(): Promise<DatacatTags> {
  if (loadedTags) return Promise.resolve(loadedTags);
  if (!pendingTags) {
    pendingTags = siteGet<DatacatTagsResponse>("datacat/tags").then(
      (reply) => {
        loadedTags = readTags(reply);
        pendingTags = null;
        return loadedTags;
      },
      (error: unknown) => {
        pendingTags = null;
        throw error;
      },
    );
  }
  return pendingTags;
}

/** Forgets the session's tag list (tests start each case fresh). */
export function resetDatacatTagsForTests() {
  loadedTags = null;
  pendingTags = null;
}

function characterTagNames(character: DatacatCharacter, tags: DatacatTags | null): string[] {
  const source = Array.isArray(character.tags)
    ? character.tags
    : Array.isArray(character.tagIds)
      ? character.tagIds
      : [];
  const names: string[] = [];
  for (const tag of source as DatacatCharacterTag[]) {
    let name = "";
    if (typeof tag === "string") name = tag;
    else if (typeof tag === "number") name = tags?.namesById.get(tag) ?? "";
    else if (isRecord(tag)) {
      const id = recordId(tag);
      name = text(tag.name) || text(tag.slug) || (id !== undefined ? (tags?.namesById.get(id) ?? "") : "");
    }
    if (name) names.push(name);
  }
  return names;
}

function datacatCard(character: DatacatCharacter, tags: DatacatTags | null): BrowserCard {
  const id = text(character.characterId) || text(character.character_id) || text(character.id);
  const avatar = text(character.avatar);
  return makeCard({
    id,
    name: text(character.chatName) || text(character.chat_name) || text(character.name),
    creator: text(character.creatorName) || text(character.creator_name),
    tagline: first200(stripHtml(text(character.description))),
    tags: characterTagNames(character, tags),
    picture: avatar ? proxyImageSource(`datacat/avatar/${encodedWhenUrl(avatar)}`) : null,
    stats: [
      { value: character.chatCount ?? character.chat_count, label: "Chats", icon: "message" },
      { value: character.totalTokens ?? character.total_tokens, label: "Tokens", icon: "hash" },
    ],
    nsfw: character.isNsfw === true,
    link: `https://datacat.run/characters/${id}`,
    raw: character,
  });
}

function charactersOf(value: unknown): DatacatCharacter[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.characters)
      ? value.characters
      : [];
  return list.filter(isRecord);
}

function datacatRecentPath(criteria: SearchCriteria, tagIds: number[]): string {
  const pairs: Array<[string, string]> = [
    ["limit", String(PAGE_SIZE)],
    ["offset", String((criteria.page - 1) * PAGE_SIZE)],
  ];
  if (tagIds.length > 0) pairs.push(["tagIds", comma(tagIds.map(String))]);
  if (hasSearchText(criteria)) pairs.push(["q", criteria.search.trim()]);
  return `datacat/recent?${formQuery(pairs)}`;
}

export const datacatProvider: BrowserProvider = {
  id: "datacat",
  name: "DataCat",
  icon: "🐱",
  site: "DataCat",
  pageSize: PAGE_SIZE,
  defaultSort: "relevance",
  sorts: [
    { value: "relevance", label: "Relevance" },
    { value: "fresh", label: "Fresh" },
  ],
  features: [],
  toggles: [],
  hasSortDirection: false,
  hasTokenFilters: false,
  nsfwMode: "locked",
  importKind: "built",
  importFetchesDetail: true,
  suggestedTags: () => loadedTags?.popular ?? [],

  async search(criteria) {
    let tags: DatacatTags | null = null;
    let tagLoadError: unknown = null;
    try {
      tags = await loadDatacatTags();
    } catch (error) {
      tagLoadError = error;
    }

    const tagIds: number[] = [];
    const notApplied: string[] = [];
    for (const tag of criteria.includeTags) {
      const id = tags?.idsByName.get(tag.toLowerCase());
      if (id === undefined) notApplied.push(tag);
      else tagIds.push(id);
    }

    const notices: string[] = [];
    if (notApplied.length > 0) {
      const loadProblem = tagLoadError
        ? ` ${toUserMessage(tagLoadError, { fallback: "DataCat's tag list didn't load." })}`
        : "";
      notices.push(`Some tags weren't applied: ${notApplied.join(", ")}.${loadProblem}`);
    }

    const tagsOf = (character: DatacatCharacter) => characterTagNames(character, tags);
    if (criteria.sort === "fresh" && tagIds.length === 0 && !hasSearchText(criteria)) {
      const reply = await siteGet<DatacatFreshResponse>(DATACAT_FRESH_PATH);
      const characters = charactersOf(reply?.windows?.last24h ?? reply?.last24h);
      const fallback = reply?.fallback;
      if (fallback?.partial === true && fallback.unavailableWindows?.includes("thisWeek")) {
        notices.push(FRESH_FALLBACK_NOTICE);
      }
      const kept = withoutExcludedTags(characters, tagsOf, criteria.excludeTags);
      return { cards: kept.map((character) => datacatCard(character, tags)), total: characters.length, notices };
    }

    const reply = await siteGet<DatacatRecentResponse>(datacatRecentPath(criteria, tagIds));
    const characters = charactersOf(reply);
    const kept = withoutExcludedTags(characters, tagsOf, criteria.excludeTags);
    const total = typeof reply?.totalCount === "number" ? reply.totalCount : characters.length;
    return { cards: kept.map((character) => datacatCard(character, tags)), total, notices };
  },

  async fetchDetail(card) {
    if (!card.id) return null;
    const id = encodeURIComponent(card.id);
    try {
      const download = await siteGet<DatacatDownloadResponse>(`datacat/download/${id}`);
      const data = isRecord(download?.data) ? download.data : null;
      if (data) {
        const detail = usableDetail({
          description: optionalText(data.description) ?? optionalText(data.personality),
          personality: optionalText(data.personality),
          scenario: optionalText(data.scenario),
          firstMessage: optionalText(data.first_mes),
          exampleDialogs: optionalText(data.mes_example),
          creatorNotes: optionalText(data.creator_notes),
          alternateGreetings: greetingsWithoutEmpty(data.alternate_greetings),
        });
        if (detail) return detail;
      }
    } catch {
      // The download route is often missing for a character; the character route below is the real answer.
    }

    const reply = await siteGet<DatacatCharacterResponse>(`datacat/character/${id}`);
    const character = isRecord(reply?.character) ? reply.character : isRecord(reply) ? reply : {};
    return usableDetail({
      description: optionalText(character.personality),
      scenario: optionalText(character.scenario),
      firstMessage: optionalText(character.first_message),
      creatorNotes:
        typeof character.description === "string" ? optionalText(stripHtml(character.description).trim()) : undefined,
    });
  },
};

import { isRecord } from "../../../../../engine/shared/value-readers";
import type { WyvernCharacter, WyvernSearchResponse } from "../../types/provider-responses";
import { proxyImageSource, siteGet } from "../site-api";
import {
  comma,
  formQuery,
  greetingsWithoutEmpty,
  hasSearchText,
  makeCard,
  optionalText,
  stringList,
  text,
  usableDetail,
  withoutExcludedTags,
} from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 48;
const NSFW_SORT = "nsfw-popular";

function wyvernSearchPath(criteria: SearchCriteria): string {
  const pairs: Array<[string, string]> = [
    ["page", String(criteria.page)],
    ["limit", String(PAGE_SIZE)],
    ["sort", criteria.sort],
  ];
  if (hasSearchText(criteria)) pairs.push(["q", criteria.search]);
  if (criteria.includeTags.length > 0) pairs.push(["tags", comma(criteria.includeTags)]);
  if (!criteria.nsfw && criteria.sort !== NSFW_SORT) pairs.push(["rating", "none"]);
  return `wyvern/search?${formQuery(pairs)}`;
}

function wyvernPicture(character: WyvernCharacter): string | null {
  const src = text(character.avatar_url) || text(character.avatar);
  if (!src) return null;
  const path = src.startsWith("http") ? encodeURIComponent(src) : `${src}/public`;
  return proxyImageSource(`wyvern/avatar/${path}`);
}

function wyvernCard(character: WyvernCharacter): BrowserCard {
  const id = text(character.id);
  const creator = isRecord(character.creator) ? character.creator : {};
  const statistics = isRecord(character.statistics_record)
    ? character.statistics_record
    : isRecord(character.entity_statistics)
      ? character.entity_statistics
      : {};
  return makeCard({
    id,
    name: text(character.name),
    creator: text(creator.displayName) || text(creator.username),
    tagline: text(character.tagline),
    tags: stringList(character.tags),
    picture: wyvernPicture(character),
    stats: [
      { value: statistics.likes ?? statistics.total_likes ?? character.likes, label: "Likes", icon: "heart" },
      {
        value: statistics.messages ?? statistics.total_messages ?? character.messages,
        label: "Messages",
        icon: "message",
      },
      { value: statistics.views ?? statistics.total_views ?? character.views, label: "Views", icon: "eye" },
    ],
    nsfw: Boolean(character.rating) && character.rating !== "none",
    link: `https://app.wyvern.chat/characters/${id}`,
    raw: character,
  });
}

export const wyvernProvider: BrowserProvider = {
  id: "wyvern",
  name: "Wyvern",
  icon: "🐉",
  site: "Wyvern",
  pageSize: PAGE_SIZE,
  defaultSort: "popular",
  sorts: [
    { value: "popular", label: "Popular" },
    { value: NSFW_SORT, label: "Popular NSFW" },
    { value: "recommended", label: "Recommended" },
    { value: "created_at", label: "New" },
    { value: "votes", label: "Most likes" },
    { value: "messages", label: "Most messages" },
  ],
  // Wyvern's search takes none of the lorebook, greeting or token filters, so none are offered (decision 4).
  features: [],
  toggles: [],
  hasSortDirection: false,
  hasTokenFilters: false,
  nsfwMode: "sort",
  importKind: "built",
  importFetchesDetail: true,

  async search(criteria) {
    const reply = await siteGet<WyvernSearchResponse>(wyvernSearchPath(criteria));
    const results = Array.isArray(reply?.results) ? reply.results.filter(isRecord) : [];
    const kept = withoutExcludedTags(results, (character) => stringList(character.tags), criteria.excludeTags);
    const total =
      typeof reply?.total === "number" ? reply.total : reply?.hasMore ? (criteria.page + 1) * PAGE_SIZE : kept.length;
    return { cards: kept.map(wyvernCard), total, notices: [] };
  },

  async fetchDetail(card) {
    const reply = await siteGet<WyvernCharacter>(`wyvern/character/${card.id}`);
    const character = isRecord(reply) ? reply : {};
    return usableDetail({
      description: optionalText(character.description),
      personality: optionalText(character.personality),
      scenario: optionalText(character.scenario),
      firstMessage: optionalText(character.first_mes),
      exampleDialogs: optionalText(character.mes_example),
      creatorNotes: optionalText(character.creator_notes),
      alternateGreetings: greetingsWithoutEmpty(character.alternate_greetings),
      hasLorebook: Array.isArray(character.lorebooks) && character.lorebooks.length > 0,
    });
  },
};

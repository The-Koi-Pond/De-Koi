import { isRecord } from "../../../../../engine/shared/value-readers";
import type { ChartavernDetailResponse, ChartavernSearchResponse } from "../../types/provider-responses";
import { proxyImageSource, siteGet } from "../site-api";
import { comma, firstSegment, formQuery, makeCard, optionalText, stringList, text, usableDetail } from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 60;

function tokenValueSent(value: string): boolean {
  return value !== "" && value !== "0";
}

function chartavernSearchPath(criteria: SearchCriteria): string {
  const pairs: Array<[string, string]> = [
    ["q", criteria.search],
    ["page", String(criteria.page)],
    ["limit", String(PAGE_SIZE)],
    ["sort", criteria.sort],
    ["nsfw", String(criteria.nsfw)],
  ];
  if (criteria.includeTags.length > 0) pairs.push(["tags", comma(criteria.includeTags)]);
  if (criteria.excludeTags.length > 0) pairs.push(["excludeTags", comma(criteria.excludeTags)]);
  if (tokenValueSent(criteria.minTokens)) pairs.push(["min_tokens", criteria.minTokens]);
  if (tokenValueSent(criteria.maxTokens)) pairs.push(["max_tokens", criteria.maxTokens]);
  if (criteria.filters.lore) pairs.push(["hasLorebook", "true"]);
  if (criteria.filters.isOC) pairs.push(["isOC", "true"]);
  return `chartavern/search?${formQuery(pairs)}`;
}

function chartavernCard(hit: Record<string, unknown>): BrowserCard {
  const path = text(hit.path);
  return makeCard({
    id: path,
    name: text(hit.name),
    creator: text(hit.author) || firstSegment(path),
    tagline: text(hit.tagline),
    tags: stringList(hit.tags),
    picture: path ? proxyImageSource(`chartavern/avatar/${path}`) : null,
    stats: [
      { value: hit.downloads, label: "Downloads", icon: "download" },
      { value: hit.likes, label: "Likes", icon: "heart" },
      { value: hit.totalTokens, label: "Tokens", icon: "hash" },
    ],
    nsfw: hit.isNSFW === true,
    link: `https://character-tavern.com/character/${path}`,
    raw: hit,
  });
}

export const chartavernProvider: BrowserProvider = {
  id: "chartavern",
  name: "CharacterTavern",
  icon: "🍺",
  site: "CharacterTavern",
  pageSize: PAGE_SIZE,
  defaultSort: "most_popular",
  sorts: [
    { value: "most_popular", label: "Most popular" },
    { value: "trending", label: "Trending" },
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "most_likes", label: "Most liked" },
  ],
  features: [{ key: "lore", label: "Lorebook" }],
  toggles: [{ key: "isOC", label: "Original character" }],
  hasSortDirection: false,
  hasTokenFilters: true,
  nsfwMode: "login",
  importKind: "png",
  importFetchesDetail: false,
  downloadPath: (card) => `chartavern/download/${card.id}`,
  login: {
    kind: "cookie",
    sessionPath: "chartavern/session",
    savePath: "chartavern/set-cookie",
    validatePath: "chartavern/validate",
    logoutPath: "chartavern/logout",
  },

  async search(criteria) {
    const reply = await siteGet<ChartavernSearchResponse>(chartavernSearchPath(criteria));
    const hits = Array.isArray(reply?.hits) ? reply.hits.filter(isRecord) : [];
    const total =
      typeof reply?.totalPages === "number"
        ? reply.totalPages * PAGE_SIZE
        : typeof reply?.totalHits === "number"
          ? reply.totalHits
          : hits.length;
    return { cards: hits.map(chartavernCard), total, notices: [] };
  },

  async fetchDetail(card) {
    const [author, slug] = card.id.split("/");
    if (!author || !slug) return null;
    const reply = await siteGet<ChartavernDetailResponse>(`chartavern/character/${author}/${slug}`);
    const detail = isRecord(reply?.card) ? reply.card : {};
    return usableDetail({
      description: optionalText(detail.definition_character_description),
      personality: optionalText(detail.definition_personality),
      scenario: optionalText(detail.definition_scenario),
      firstMessage: optionalText(detail.definition_first_message),
      exampleDialogs: optionalText(detail.definition_example_messages),
      creatorNotes: optionalText(detail.description),
      hasLorebook: detail.lorebookId !== undefined && detail.lorebookId !== null && detail.lorebookId !== "",
    });
  },
};

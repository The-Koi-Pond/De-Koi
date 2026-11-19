import { isRecord } from "../../../../../engine/shared/value-readers";
import type { ChubDetailResponse, ChubSearchResponse } from "../../types/provider-responses";
import { proxyImageSource, siteGet } from "../site-api";
import {
  comma,
  firstSegment,
  formQuery,
  hasSearchText,
  makeCard,
  optionalText,
  stringList,
  text,
  usableDetail,
} from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 48;

interface ChubSortRule {
  sort: string;
  days: number;
  specialMode?: string;
}

const SORT_RULES: Record<string, ChubSortRule> = {
  popular_all: { sort: "download_count", days: 0 },
  popular_week: { sort: "download_count", days: 7 },
  popular_month: { sort: "download_count", days: 30 },
  rated_week: { sort: "star_count", days: 7 },
  rated_all: { sort: "star_count", days: 0 },
  newest: { sort: "id", days: 30 },
  updated: { sort: "last_activity_at", days: 0 },
  recent_hits: { sort: "default", days: 0, specialMode: "newcomer" },
  random: { sort: "random", days: 0 },
};

const FEATURE_PARAMS: Record<string, string> = {
  images: "require_images",
  lore: "require_lore",
  expressions: "require_expressions",
  greetings: "require_alternate_greetings",
};

function chubSearchPath(criteria: SearchCriteria): string {
  const rule = SORT_RULES[criteria.sort] ?? SORT_RULES.popular_week;
  const pairs: Array<[string, string]> = [
    ["q", criteria.search],
    ["page", String(criteria.page)],
    ["nsfw", String(criteria.nsfw)],
  ];
  if (hasSearchText(criteria)) {
    if (rule.sort !== "default") pairs.push(["sort", rule.sort]);
  } else {
    pairs.push(["sort", rule.sort]);
    if (rule.days > 0) pairs.push(["max_days_ago", String(rule.days)]);
    if (rule.specialMode) pairs.push(["special_mode", rule.specialMode]);
  }
  if (criteria.ascending) pairs.push(["asc", "true"]);
  if (criteria.includeTags.length > 0) pairs.push(["tags", comma(criteria.includeTags)]);
  if (criteria.excludeTags.length > 0) pairs.push(["excludeTags", comma(criteria.excludeTags)]);
  if (criteria.minTokens !== "") pairs.push(["min_tokens", criteria.minTokens]);
  if (criteria.maxTokens !== "") pairs.push(["max_tokens", criteria.maxTokens]);
  for (const [key, param] of Object.entries(FEATURE_PARAMS)) {
    if (criteria.filters[key]) pairs.push([param, "true"]);
  }
  return `chub/search?${formQuery(pairs)}`;
}

function chubCard(node: Record<string, unknown>): BrowserCard {
  const fullPath = text(node.fullPath);
  return makeCard({
    id: fullPath,
    name: text(node.name),
    creator: firstSegment(fullPath),
    tagline: text(node.tagline),
    tags: stringList(node.topics),
    picture: proxyImageSource(`chub/avatar/${fullPath}`),
    stats: [
      { value: node.starCount, label: "Stars", icon: "star" },
      { value: node.nChats, label: "Chats", icon: "message" },
      { value: node.nTokens, label: "Tokens", icon: "hash" },
    ],
    nsfw: node.nsfw === true,
    link: `https://chub.ai/characters/${fullPath}`,
    raw: node,
  });
}

function hasCursor(cursor: unknown): boolean {
  return cursor !== undefined && cursor !== null && cursor !== "" && cursor !== false;
}

export const chubProvider: BrowserProvider = {
  id: "chub",
  name: "ChubAI",
  icon: "✦",
  site: "Chub",
  pageSize: PAGE_SIZE,
  defaultSort: "popular_all",
  sorts: [
    { value: "popular_all", label: "Most downloaded", group: "Popular" },
    { value: "popular_week", label: "Hot this week", group: "Popular" },
    { value: "popular_month", label: "Hot this month", group: "Popular" },
    { value: "rated_week", label: "Top rated (week)", group: "Quality" },
    { value: "rated_all", label: "Top rated (all time)", group: "Quality" },
    { value: "newest", label: "Newest", group: "Discovery" },
    { value: "updated", label: "Recently updated", group: "Discovery" },
    { value: "recent_hits", label: "Recent hits", group: "Discovery" },
    { value: "random", label: "Random", group: "Discovery" },
  ],
  features: [
    { key: "images", label: "Image gallery" },
    { key: "lore", label: "Lorebook" },
    { key: "expressions", label: "Expressions" },
    { key: "greetings", label: "Alt greetings" },
  ],
  toggles: [],
  hasSortDirection: true,
  hasTokenFilters: true,
  nsfwMode: "free",
  importKind: "png",
  importFetchesDetail: true,
  downloadPath: (card) => `chub/download/${card.id}`,

  async search(criteria) {
    const reply = await siteGet<ChubSearchResponse>(chubSearchPath(criteria));
    const source = isRecord(reply?.data) ? reply.data : (reply ?? {});
    const nodes = Array.isArray(source.nodes) ? source.nodes.filter(isRecord) : [];
    const total = hasCursor(source.cursor)
      ? (criteria.page + 1) * PAGE_SIZE
      : (criteria.page - 1) * PAGE_SIZE + nodes.length;
    return { cards: nodes.map(chubCard), total, pageHits: nodes.length, notices: [] };
  },

  async fetchDetail(card) {
    const reply = await siteGet<ChubDetailResponse>(`chub/character/${card.id}`);
    const node = reply?.data?.node ?? reply?.node;
    if (!isRecord(node)) return null;
    const definition = isRecord(node.definition) ? node.definition : {};
    const embedded = definition.embedded_lorebook;
    return usableDetail({
      description: optionalText(definition.personality),
      personality: optionalText(definition.tavern_personality),
      scenario: optionalText(definition.scenario),
      firstMessage: optionalText(definition.first_message),
      exampleDialogs: optionalText(definition.example_dialogs),
      alternateGreetings: stringList(definition.alternate_greetings),
      creatorNotes: optionalText(definition.description),
      systemPrompt: optionalText(definition.system_prompt),
      postHistoryInstructions: optionalText(definition.post_history_instructions),
      characterVersion: optionalText(definition.character_version),
      providerExtensions: isRecord(definition.extensions) ? definition.extensions : undefined,
      embeddedLorebook: embedded ?? undefined,
      hasLorebook: embedded !== undefined && embedded !== null,
    });
  },
};

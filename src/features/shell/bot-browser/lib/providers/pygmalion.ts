import { isRecord } from "../../../../../engine/shared/value-readers";
import type {
  PygmalionCharacter,
  PygmalionDetailResponse,
  PygmalionSearchResponse,
} from "../../types/provider-responses";
import { proxyImageSource, siteGet } from "../site-api";
import {
  comma,
  encodedWhenUrl,
  formQuery,
  greetingsWithoutEmpty,
  idText,
  makeCard,
  optionalText,
  stringList,
  text,
  usableDetail,
} from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 48;

function pygmalionSearchPath(criteria: SearchCriteria): string {
  const pairs: Array<[string, string]> = [
    ["q", criteria.search],
    ["page", String(Math.max(0, criteria.page - 1))],
    ["pageSize", String(PAGE_SIZE)],
    ["orderBy", criteria.sort],
    ["orderDescending", String(!criteria.ascending)],
  ];
  if (criteria.includeTags.length > 0) pairs.push(["tagsInclude", comma(criteria.includeTags)]);
  if (criteria.excludeTags.length > 0) pairs.push(["tagsExclude", comma(criteria.excludeTags)]);
  if (criteria.nsfw) pairs.push(["includeSensitive", "true"]);
  return `pygmalion/search?${formQuery(pairs)}`;
}

function wholeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function pygmalionCard(character: PygmalionCharacter): BrowserCard {
  const id = idText(character.id);
  const avatar = text(character.avatarUrl);
  const owner = isRecord(character.owner) ? character.owner : {};
  return makeCard({
    id,
    name: text(character.displayName),
    creator: text(owner.username) || text(owner.displayName),
    tagline: text(character.description),
    tags: stringList(character.tags),
    picture: avatar ? proxyImageSource(`pygmalion/avatar/${encodedWhenUrl(avatar)}`) : null,
    stats: [
      { value: character.downloads, label: "Downloads", icon: "download" },
      { value: character.stars, label: "Stars", icon: "star" },
      { value: character.chatCount, label: "Chats", icon: "message" },
    ],
    nsfw: character.isSensitive === true,
    link: `https://pygmalion.chat/character/${id}`,
    raw: character,
  });
}

export const pygmalionProvider: BrowserProvider = {
  id: "pygmalion",
  name: "Pygmalion",
  icon: "🔥",
  site: "Pygmalion",
  pageSize: PAGE_SIZE,
  defaultSort: "downloads",
  sorts: [
    { value: "downloads", label: "Downloads" },
    { value: "stars", label: "Stars" },
    { value: "views", label: "Views" },
    { value: "approved_at", label: "Newest" },
    { value: "token_count", label: "Tokens" },
    { value: "display_name", label: "Name" },
  ],
  features: [],
  toggles: [],
  hasSortDirection: true,
  hasTokenFilters: false,
  nsfwMode: "login",
  importKind: "built",
  importFetchesDetail: true,
  login: {
    kind: "token",
    sessionPath: "pygmalion/session",
    savePath: "pygmalion/set-token",
    validatePath: "pygmalion/validate",
    logoutPath: "pygmalion/logout",
  },

  async search(criteria) {
    const reply = await siteGet<PygmalionSearchResponse>(pygmalionSearchPath(criteria));
    const characters = Array.isArray(reply?.characters) ? reply.characters.filter(isRecord) : [];
    return {
      cards: characters.map(pygmalionCard),
      total: wholeNumber(reply?.totalItems),
      pageHits: characters.length,
      notices: [],
    };
  },

  async fetchDetail(card) {
    const reply = await siteGet<PygmalionDetailResponse>(`pygmalion/character?id=${card.id}`);
    const personality = isRecord(reply?.character?.personality) ? reply.character.personality : {};
    return usableDetail({
      description: optionalText(personality.persona),
      firstMessage: optionalText(personality.greeting),
      exampleDialogs: optionalText(personality.mesExample),
      creatorNotes: optionalText(personality.characterNotes),
      alternateGreetings: greetingsWithoutEmpty(personality.alternateGreetings),
    });
  },
};

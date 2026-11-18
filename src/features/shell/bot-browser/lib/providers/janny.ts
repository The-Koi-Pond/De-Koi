import { isRecord } from "../../../../../engine/shared/value-readers";
import type { JannyCharacterResponse, JannyHit, JannySearchResponse } from "../../types/provider-responses";
import { proxyImageSource, searchJannyWithFallback, siteGet } from "../site-api";
import { first200, makeCard, optionalText, stripHtml, text, usableDetail } from "./shared";
import type { BrowserCard, BrowserProvider, SearchCriteria } from "./types";

const PAGE_SIZE = 80;
/** How many more pages a search with tag checks on this side may fetch to fill a page. */
const EXTRA_PAGES = 3;

const SORTS: Record<string, string | null> = {
  newest: "createdAtStamp:desc",
  oldest: "createdAtStamp:asc",
  tokens_desc: "totalToken:desc",
  tokens_asc: "totalToken:asc",
  relevant: null,
};

/** JannyAI's tags are numbers; this is the site's fixed list. */
const JANNY_TAGS: Record<number, string> = {
  1: "Male",
  2: "Female",
  3: "Non-binary",
  4: "Celebrity",
  5: "OC",
  6: "Fictional",
  7: "Real",
  8: "Game",
  9: "Anime",
  10: "Historical",
  11: "Royalty",
  12: "Detective",
  13: "Hero",
  14: "Villain",
  15: "Magical",
  16: "Non-human",
  17: "Monster",
  18: "Monster Girl",
  19: "Alien",
  20: "Robot",
  21: "Politics",
  22: "Vampire",
  23: "Giant",
  24: "OpenAI",
  25: "Elf",
  26: "Multiple",
  27: "VTuber",
  28: "Dominant",
  29: "Submissive",
  30: "Scenario",
  31: "Pokemon",
  32: "Assistant",
  34: "Non-English",
  36: "Philosophy",
  38: "RPG",
  39: "Religion",
  41: "Books",
  42: "AnyPOV",
  43: "Angst",
  44: "Demi-Human",
  45: "Enemies to Lovers",
  46: "Smut",
  47: "MLM",
  48: "WLW",
  49: "Action",
  50: "Romance",
  51: "Horror",
  52: "Slice of Life",
  53: "Fantasy",
  54: "Drama",
  55: "Comedy",
  56: "Mystery",
  57: "Sci-Fi",
  59: "Yandere",
  60: "Furry",
  61: "Movies/TV",
};

const TAG_IDS_BY_NAME = new Map(Object.entries(JANNY_TAGS).map(([id, name]) => [name.toLowerCase(), Number(id)]));

function tagName(id: number): string {
  return JANNY_TAGS[id] ?? `Tag ${id}`;
}

function tagNames(hit: JannyHit): string[] {
  return Array.isArray(hit.tagIds) ? hit.tagIds.filter((id) => typeof id === "number").map(tagName) : [];
}

/** The name as a URL slug: lowercased, each run of other characters than a–z and 0–9 as `-`, no `-` at the ends. */
function jannySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wholeNumberOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The multi-search body for one page; the screen posts it as `{ payload: body }`. */
function jannySearchBody(criteria: SearchCriteria, page = criteria.page) {
  const filter = [
    `totalToken >= ${wholeNumberOr(criteria.minTokens, 29)}`,
    `totalToken <= ${wholeNumberOr(criteria.maxTokens, 100000)}`,
  ];
  if (!criteria.nsfw) filter.push("isNsfw = false");
  if (!criteria.filters.showLowQuality) filter.push("isLowQuality = false");
  const tagIds = criteria.includeTags
    .map((tag) => TAG_IDS_BY_NAME.get(tag.toLowerCase()))
    .filter((id): id is number => id !== undefined);
  if (tagIds.length > 0) filter.push(tagIds.map((id) => `tagIds = ${id}`).join(" AND "));

  const sort = criteria.sort in SORTS ? SORTS[criteria.sort] : SORTS.newest;
  return {
    queries: [
      {
        indexUid: "janny-characters",
        q: criteria.search,
        facets: ["isLowQuality", "isNsfw", "tagIds", "totalToken"],
        attributesToCrop: ["description:300"],
        cropMarker: "...",
        filter,
        attributesToHighlight: ["name", "description"],
        highlightPreTag: "__ais-highlight__",
        highlightPostTag: "__/ais-highlight__",
        hitsPerPage: PAGE_SIZE,
        page,
        ...(sort ? { sort: [sort] } : {}),
      },
    ],
  };
}

function firstResult(reply: JannySearchResponse | null | undefined) {
  const result = Array.isArray(reply?.results) ? reply.results[0] : undefined;
  return isRecord(result) ? result : {};
}

function jannyCard(hit: JannyHit): BrowserCard {
  const id = text(hit.id);
  const name = text(hit.name);
  const avatar = text(hit.avatar);
  return makeCard({
    id,
    name,
    creator: text(hit.creatorUsername),
    tagline: first200(stripHtml(text(hit.description))),
    tags: tagNames(hit),
    picture: avatar ? proxyImageSource(`janny/avatar/${avatar}`) : null,
    stats: [{ value: hit.totalToken, label: "Tokens", icon: "hash" }],
    nsfw: hit.isNsfw === true,
    link: `https://jannyai.com/characters/${id}_character-${jannySlug(name)}`,
    raw: hit,
  });
}

export const jannyProvider: BrowserProvider = {
  id: "janny",
  name: "JannyAI",
  icon: "🤖",
  site: "JannyAI",
  pageSize: PAGE_SIZE,
  defaultSort: "newest",
  sorts: [
    { value: "newest", label: "Newest", group: "Date" },
    { value: "oldest", label: "Oldest", group: "Date" },
    { value: "tokens_desc", label: "Most tokens", group: "Tokens" },
    { value: "tokens_asc", label: "Least tokens", group: "Tokens" },
    { value: "relevant", label: "Relevance", group: "Search" },
  ],
  features: [],
  toggles: [{ key: "showLowQuality", label: "Show low quality" }],
  hasSortDirection: false,
  hasTokenFilters: true,
  nsfwMode: "free",
  importKind: "built",
  importFetchesDetail: true,

  async search(criteria) {
    const customTags = criteria.includeTags
      .filter((tag) => !TAG_IDS_BY_NAME.has(tag.toLowerCase()))
      .map((tag) => tag.toLowerCase());
    const excluded = new Set(criteria.excludeTags.map((tag) => tag.toLowerCase()));
    const checksHere = customTags.length > 0 || excluded.size > 0;
    const keep = (hit: JannyHit) => {
      if (!checksHere) return true;
      const names = tagNames(hit).map((name) => name.toLowerCase());
      if (names.some((name) => excluded.has(name))) return false;
      return customTags.every((tag) => names.includes(tag));
    };

    const first = firstResult(await searchJannyWithFallback<JannySearchResponse>(jannySearchBody(criteria)));
    const hitsOf = (result: ReturnType<typeof firstResult>) =>
      (Array.isArray(result.hits) ? result.hits : []).filter((hit): hit is JannyHit => isRecord(hit));
    const totalPages = typeof first.totalPages === "number" ? first.totalPages : 1;
    const kept = hitsOf(first).filter(keep);

    if (checksHere) {
      let page = criteria.page;
      for (let extra = 0; extra < EXTRA_PAGES && kept.length < PAGE_SIZE && page < totalPages; extra += 1) {
        page += 1;
        const next = firstResult(await searchJannyWithFallback<JannySearchResponse>(jannySearchBody(criteria, page)));
        kept.push(...hitsOf(next).filter(keep));
      }
    }

    const total = typeof first.totalHits === "number" ? first.totalHits : totalPages * PAGE_SIZE;
    return { cards: kept.map(jannyCard), total, notices: [] };
  },

  async fetchDetail(card) {
    const hit = (isRecord(card.raw) ? card.raw : {}) as JannyHit;
    const reply = await siteGet<JannyCharacterResponse>(
      `janny/character/${card.id}?slug=character-${jannySlug(text(hit.name))}`,
    );
    const character = isRecord(reply?.character) ? reply.character : null;
    if (character && (character.personality || character.firstMessage)) {
      return usableDetail({
        description: optionalText(character.personality),
        scenario: optionalText(character.scenario),
        firstMessage: optionalText(character.firstMessage),
        exampleDialogs: optionalText(character.exampleDialogs),
        creatorNotes:
          typeof character.description === "string" ? optionalText(stripHtml(character.description).trim()) : undefined,
      });
    }
    const notes = stripHtml(text(hit.description)).trim();
    return notes ? { creatorNotes: notes } : null;
  },
};

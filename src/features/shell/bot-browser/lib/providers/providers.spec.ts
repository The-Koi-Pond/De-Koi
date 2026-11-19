import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  replies: new Map<string, unknown>(),
  calls: [] as string[],
}));

function lookup(path: string) {
  api.calls.push(path);
  for (const [prefix, value] of api.replies) {
    if (path.startsWith(prefix)) {
      if (value instanceof Error) throw value;
      return value;
    }
  }
  throw new Error(`No reply for ${path}`);
}

vi.mock("../../../../../shared/api/bot-browser-command-api", () => ({
  botBrowserCommandApi: {
    get: async (path: string) => lookup(path),
    post: async (path: string) => lookup(path),
  },
}));

import { chartavernProvider } from "./chartavern";
import { chubProvider } from "./chub";
import { datacatProvider, resetDatacatTagsForTests } from "./datacat";
import { jannyProvider } from "./janny";
import { pygmalionProvider } from "./pygmalion";
import type { BrowserCard, SearchCriteria } from "./types";
import { wyvernProvider } from "./wyvern";

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    search: "",
    sort: "",
    page: 1,
    nsfw: false,
    ascending: false,
    minTokens: "",
    maxTokens: "",
    filters: {},
    includeTags: [],
    excludeTags: [],
    ...overrides,
  };
}

function shown(card: BrowserCard) {
  const { raw: _raw, ...rest } = card;
  return rest;
}

beforeEach(() => {
  api.replies.clear();
  api.calls.length = 0;
  resetDatacatTagsForTests();
});

describe("ChubAI", () => {
  it("turns a search reply into cards and works out the total", async () => {
    api.replies.set("chub/search", {
      data: {
        nodes: [
          {
            fullPath: "ink/lighthouse",
            name: "Keeper",
            tagline: "Minds the light.",
            topics: ["Sea", "Calm"],
            starCount: 1200,
            nChats: 0,
            nTokens: 900,
            nsfw: false,
          },
          { fullPath: "ink/empty" },
        ],
        cursor: null,
      },
    });
    const page = await chubProvider.search(criteria({ sort: "popular_all", page: 3 }));
    expect(page.total).toBe(2 * 48 + 2);
    expect(shown(page.cards[0])).toEqual({
      id: "ink/lighthouse",
      name: "Keeper",
      creator: "ink",
      tagline: "Minds the light.",
      tags: ["Sea", "Calm"],
      picture: "tauri-api:/bot-browser/chub/avatar/ink/lighthouse",
      stats: [
        { value: 1200, label: "Stars", icon: "star" },
        { value: 900, label: "Tokens", icon: "hash" },
      ],
      nsfw: false,
      link: "https://chub.ai/characters/ink/lighthouse",
    });
    expect(page.cards[1].name).toBe("Unnamed");

    api.replies.set("chub/search", { nodes: [], cursor: "next" });
    expect((await chubProvider.search(criteria({ page: 2 }))).total).toBe(3 * 48);
  });

  it("reads the detail's definition, with empty strings as missing", async () => {
    const card = (await withCard(chubProvider, "chub/search", { nodes: [{ fullPath: "ink/lighthouse" }] }))[0];
    api.replies.set("chub/character/", {
      data: {
        node: {
          definition: {
            personality: "Steady.",
            tavern_personality: "",
            first_message: "Hello.",
            description: "Notes.",
            system_prompt: "Stay kind.",
            character_version: "2",
            extensions: { depth_prompt: { prompt: "x" } },
            embedded_lorebook: { entries: [{ keys: ["sea"], content: "Salt." }] },
          },
        },
      },
    });
    expect(await chubProvider.fetchDetail(card)).toEqual({
      description: "Steady.",
      firstMessage: "Hello.",
      creatorNotes: "Notes.",
      systemPrompt: "Stay kind.",
      characterVersion: "2",
      alternateGreetings: [],
      providerExtensions: { depth_prompt: { prompt: "x" } },
      embeddedLorebook: { entries: [{ keys: ["sea"], content: "Salt." }] },
      hasLorebook: true,
    });
    expect(api.calls.at(-1)).toBe("chub/character/ink/lighthouse");

    api.replies.set("chub/character/", { data: {} });
    expect(await chubProvider.fetchDetail(card)).toBeNull();

    api.replies.set("chub/character/", new Error("Upstream returned 500"));
    await expect(chubProvider.fetchDetail(card)).rejects.toThrow("Upstream returned 500");
  });
});

async function withCard(provider: typeof chubProvider, prefix: string, reply: unknown, search = criteria()) {
  api.replies.set(prefix, reply);
  return (await provider.search(search)).cards;
}

describe("JannyAI", () => {
  it("makes cards with mapped tags, a stripped tagline and a trimmed slug in the link", async () => {
    const cards = await withCard(jannyProvider, "janny/search", {
      results: [
        {
          hits: [
            {
              id: "abc",
              name: "[Ellie] the Bard!",
              creatorUsername: "quill",
              description: `<p>${"Sings. ".repeat(40)}</p>`,
              tagIds: [53, 99],
              avatar: "x/y.webp",
              totalToken: 1500,
              isNsfw: true,
            },
          ],
          totalPages: 3,
        },
      ],
    });
    const card = cards[0];
    expect(card.tags).toEqual(["Fantasy", "Tag 99"]);
    expect(card.tagline).toBe("Sings. ".repeat(40).slice(0, 200));
    expect(card.picture).toBe("tauri-api:/bot-browser/janny/avatar/x/y.webp");
    expect(card.link).toBe("https://jannyai.com/characters/abc_character-ellie-the-bard");
    expect(card.stats).toEqual([{ value: 1500, label: "Tokens", icon: "hash" }]);
    expect(card.nsfw).toBe(true);
  });

  it("uses totalHits, else pages times 80", async () => {
    api.replies.set("janny/search", { results: [{ hits: [], totalPages: 3 }] });
    expect((await jannyProvider.search(criteria({ sort: "newest" }))).total).toBe(240);
    api.replies.set("janny/search", { results: [{ hits: [], totalPages: 3, totalHits: 7 }] });
    expect((await jannyProvider.search(criteria({ sort: "newest" }))).total).toBe(7);
  });

  it("checks custom and excluded tags here, fetching at most 3 more pages and never past the last", async () => {
    api.replies.set("janny/search", {
      results: [
        {
          hits: [
            { id: "1", name: "A", tagIds: [53] },
            { id: "2", name: "B", tagIds: [53, 51] },
          ],
          totalPages: 2,
        },
      ],
    });
    const page = await jannyProvider.search(
      criteria({ sort: "newest", includeTags: ["Fantasy", "tag 53x"], excludeTags: ["horror"] }),
    );
    expect(page.cards).toEqual([]);
    expect(api.calls).toEqual(["janny/search", "janny/search"]);

    api.calls.length = 0;
    const kept = await jannyProvider.search(criteria({ sort: "newest", excludeTags: ["HORROR"] }));
    expect(kept.cards.map((card) => card.id)).toEqual(["1", "1"]);
  });

  it("reads the detail, else keeps the search hit's description as notes", async () => {
    const [card] = await withCard(jannyProvider, "janny/search", {
      results: [{ hits: [{ id: "abc", name: " Kiryu ", description: "<b>Hit notes</b> " }] }],
    });
    api.replies.set("janny/character/", {
      character: { personality: "Stern.", firstMessage: "Hey.", description: " <i>Notes</i> " },
    });
    expect(await jannyProvider.fetchDetail(card)).toEqual({
      description: "Stern.",
      firstMessage: "Hey.",
      creatorNotes: "Notes",
    });
    expect(api.calls.at(-1)).toBe("janny/character/abc?slug=character-kiryu");

    api.replies.set("janny/character/", { character: {} });
    expect(await jannyProvider.fetchDetail(card)).toEqual({ creatorNotes: "Hit notes" });
  });
});

describe("CharacterTavern", () => {
  it("makes cards and works out the total", async () => {
    api.replies.set("chartavern/search", {
      hits: [
        {
          path: "maker/host",
          name: "Host",
          tagline: "Pours.",
          tags: ["Tavern"],
          downloads: 3400000,
          likes: 2,
          totalTokens: 0,
          isNSFW: true,
        },
        { name: "Pathless", author: "someone" },
      ],
      totalHits: 9,
    });
    const page = await chartavernProvider.search(criteria({ sort: "most_popular" }));
    expect(page.total).toBe(9);
    expect(shown(page.cards[0])).toEqual({
      id: "maker/host",
      name: "Host",
      creator: "maker",
      tagline: "Pours.",
      tags: ["Tavern"],
      picture: "tauri-api:/bot-browser/chartavern/avatar/maker/host",
      stats: [
        { value: 3400000, label: "Downloads", icon: "download" },
        { value: 2, label: "Likes", icon: "heart" },
      ],
      nsfw: true,
      link: "https://character-tavern.com/character/maker/host",
    });
    expect(page.cards[1]).toMatchObject({ creator: "someone", picture: null, tags: [] });

    api.replies.set("chartavern/search", { hits: [], totalPages: 4, totalHits: 9 });
    expect((await chartavernProvider.search(criteria())).total).toBe(240);
  });

  it("fetches the detail only for a two-part path", async () => {
    const [card, pathless] = await withCard(chartavernProvider, "chartavern/search", {
      hits: [{ path: "maker/host" }, { path: "solo" }],
    });
    api.replies.set("chartavern/character/maker/host", {
      card: { definition_character_description: "Warm.", definition_first_message: "Welcome.", lorebookId: "lb1" },
    });
    expect(await chartavernProvider.fetchDetail(card)).toEqual({
      description: "Warm.",
      firstMessage: "Welcome.",
      hasLorebook: true,
    });
    api.calls.length = 0;
    expect(await chartavernProvider.fetchDetail(pathless)).toBeNull();
    expect(api.calls).toEqual([]);
  });
});

describe("Pygmalion", () => {
  it("makes cards, encodes full picture URLs and reads the total as a whole number", async () => {
    api.replies.set("pygmalion/search", {
      characters: [
        {
          id: "p1",
          displayName: "Gardener",
          description: "Grows.",
          owner: { displayName: "Green" },
          avatarUrl: "https://assets.example/a b.webp",
          tags: ["Calm"],
          downloads: 5,
          stars: 0,
          chatCount: 7,
          isSensitive: false,
        },
        { id: "p2", avatarUrl: "folder/pic.webp", owner: { username: "user2", displayName: "Two" } },
      ],
      totalItems: "120",
    });
    const page = await pygmalionProvider.search(criteria({ sort: "downloads" }));
    expect(page.total).toBe(120);
    expect(shown(page.cards[0])).toEqual({
      id: "p1",
      name: "Gardener",
      creator: "Green",
      tagline: "Grows.",
      tags: ["Calm"],
      picture: `tauri-api:/bot-browser/pygmalion/avatar/${encodeURIComponent("https://assets.example/a b.webp")}`,
      stats: [
        { value: 5, label: "Downloads", icon: "download" },
        { value: 7, label: "Chats", icon: "message" },
      ],
      nsfw: false,
      link: "https://pygmalion.chat/character/p1",
    });
    expect(page.cards[1]).toMatchObject({
      creator: "user2",
      picture: "tauri-api:/bot-browser/pygmalion/avatar/folder/pic.webp",
    });
  });

  it("reads the detail's personality block", async () => {
    const [card] = await withCard(pygmalionProvider, "pygmalion/search", { characters: [{ id: "p1" }] });
    api.replies.set("pygmalion/character", {
      character: {
        personality: { persona: "Patient.", greeting: "Hi.", alternateGreetings: ["", "Hello again."] },
      },
    });
    expect(await pygmalionProvider.fetchDetail(card)).toEqual({
      description: "Patient.",
      firstMessage: "Hi.",
      alternateGreetings: ["Hello again."],
    });
    expect(api.calls.at(-1)).toBe("pygmalion/character?id=p1");
  });
});

describe("Wyvern", () => {
  it("makes cards from either statistics block and leaves out excluded tags", async () => {
    api.replies.set("wyvern/search", {
      results: [
        {
          id: "w1",
          name: "Ferry",
          tagline: "Rows.",
          tags: ["River"],
          avatar_url: "https://imagedelivery.net/a/b",
          rating: "mature",
          creator: { username: "oar" },
          entity_statistics: { total_likes: 3, total_messages: 4 },
          views: 9,
        },
        { id: "w2", name: "Skipped", tags: ["Horror"], avatar: "abc123" },
        { id: "w3", avatar: "abc123", rating: "none" },
      ],
      hasMore: true,
    });
    const page = await wyvernProvider.search(criteria({ sort: "popular", page: 2, excludeTags: ["horror"] }));
    expect(page.total).toBe(3 * 48);
    expect(shown(page.cards[0])).toEqual({
      id: "w1",
      name: "Ferry",
      creator: "oar",
      tagline: "Rows.",
      tags: ["River"],
      picture: `tauri-api:/bot-browser/wyvern/avatar/${encodeURIComponent("https://imagedelivery.net/a/b")}`,
      stats: [
        { value: 3, label: "Likes", icon: "heart" },
        { value: 4, label: "Messages", icon: "message" },
        { value: 9, label: "Views", icon: "eye" },
      ],
      nsfw: true,
      link: "https://app.wyvern.chat/characters/w1",
    });
    expect(page.cards.map((card) => card.id)).toEqual(["w1", "w3"]);
    expect(page.cards[1]).toMatchObject({ picture: "tauri-api:/bot-browser/wyvern/avatar/abc123/public", nsfw: false });
  });

  it("reads the character as the detail and flags a lorebook it can't bring", async () => {
    const [card] = await withCard(wyvernProvider, "wyvern/search", { results: [{ id: "w1" }], total: 1 });
    api.replies.set("wyvern/character/w1", {
      description: "Quiet.",
      first_mes: "Aboard.",
      alternate_greetings: ["Again.", " "],
      lorebooks: [{ id: "lb" }],
    });
    expect(await wyvernProvider.fetchDetail(card)).toEqual({
      description: "Quiet.",
      firstMessage: "Aboard.",
      alternateGreetings: ["Again."],
      hasLorebook: true,
    });
  });
});

describe("DataCat", () => {
  const tags = {
    tags: [{ tag_id: 6, name: "Fantasy", count: 40 }, { tagId: 7, slug: "drama", count: 90 }, { name: "x" }],
  };

  it("loads the tag names once per session and resolves character tags", async () => {
    api.replies.set("datacat/tags", tags);
    api.replies.set("datacat/recent", {
      characters: [
        {
          character_id: "d1",
          chat_name: "Moth",
          creator_name: "lamp",
          description: "<p>Flutters.</p>",
          tagIds: [6, { id: 7 }, { name: "Custom" }, 404],
          avatar: "https://ella.example/a.webp",
          chat_count: 12,
          totalTokens: 300,
          isNsfw: true,
        },
      ],
    });
    const page = await datacatProvider.search(criteria({ sort: "relevance" }));
    expect(page.total).toBe(1);
    expect(shown(page.cards[0])).toEqual({
      id: "d1",
      name: "Moth",
      creator: "lamp",
      tagline: "Flutters.",
      tags: ["Fantasy", "drama", "Custom"],
      picture: `tauri-api:/bot-browser/datacat/avatar/${encodeURIComponent("https://ella.example/a.webp")}`,
      stats: [
        { value: 12, label: "Chats", icon: "message" },
        { value: 300, label: "Tokens", icon: "hash" },
      ],
      nsfw: true,
      link: "https://datacat.run/characters/d1",
    });
    expect(datacatProvider.suggestedTags?.()).toEqual(["drama", "Fantasy"]);

    await datacatProvider.search(criteria({ sort: "relevance" }));
    expect(api.calls.filter((path) => path === "datacat/tags")).toHaveLength(1);
  });

  it("says which tags weren't applied, with the tag list's load error (decision 8)", async () => {
    api.replies.set("datacat/tags", tags);
    api.replies.set("datacat/recent", { characters: [] });
    const page = await datacatProvider.search(criteria({ sort: "relevance", includeTags: ["fantasy", "zzqx"] }));
    expect(api.calls.at(-1)).toBe("datacat/recent?limit=80&offset=0&tagIds=6");
    expect(page.notices).toEqual(["Some tags weren't applied: zzqx."]);

    resetDatacatTagsForTests();
    api.replies.set("datacat/tags", new Error("Upstream returned 503"));
    const failed = await datacatProvider.search(criteria({ sort: "relevance", includeTags: ["fantasy"] }));
    expect(failed.notices).toEqual(["Some tags weren't applied: fantasy. DataCat's tag list didn't load."]);
    expect(api.calls.at(-1)).toBe("datacat/recent?limit=80&offset=0");

    api.replies.set("datacat/tags", tags);
    await datacatProvider.search(criteria({ sort: "relevance" }));
    expect(api.calls.filter((path) => path === "datacat/tags")).toHaveLength(3);
  });

  it("uses Fresh for the fresh sort and shows its fallback notice", async () => {
    api.replies.set("datacat/tags", tags);
    api.replies.set("datacat/fresh", {
      last24h: [
        { id: "f1", name: "New" },
        { id: "f2", name: "Newer" },
      ],
      fallback: { partial: true, unavailableWindows: ["thisWeek"] },
    });
    const page = await datacatProvider.search(criteria({ sort: "fresh" }));
    expect(page.total).toBe(2);
    expect(page.cards.map((card) => card.name)).toEqual(["New", "Newer"]);
    expect(page.notices).toEqual([
      "DataCat Fresh is using recent-public results while the weekly window is unavailable.",
    ]);
  });

  it("tries the download route first and falls through to the character route", async () => {
    const card = { id: "d 1", raw: {} } as BrowserCard;
    api.replies.set("datacat/download/", new Error("Not found"));
    api.replies.set("datacat/character/", { character: { personality: "Soft.", description: " <b>Notes</b> " } });
    expect(await datacatProvider.fetchDetail(card)).toEqual({ description: "Soft.", creatorNotes: "Notes" });
    expect(api.calls).toEqual(["datacat/download/d%201", "datacat/character/d%201"]);

    api.calls.length = 0;
    api.replies.set("datacat/download/", { data: { personality: "Only personality.", first_mes: "Hi." } });
    expect(await datacatProvider.fetchDetail(card)).toEqual({
      description: "Only personality.",
      personality: "Only personality.",
      firstMessage: "Hi.",
    });
    expect(api.calls).toEqual(["datacat/download/d%201"]);

    api.replies.set("datacat/download/", { error: "missing" });
    api.replies.set("datacat/character/", new Error("Upstream returned 404"));
    await expect(datacatProvider.fetchDetail(card)).rejects.toThrow("Upstream returned 404");
    expect(await datacatProvider.fetchDetail({ ...card, id: "" })).toBeNull();
  });
});

describe("spec-writer rulings and odd replies", () => {
  it("uses a DataCat download that answered with data, even when nothing in it is usable (ruling A)", async () => {
    const card = { id: "d1", raw: {} } as BrowserCard;
    api.replies.set("datacat/download/", { data: { description: "", alternate_greetings: [] } });
    api.replies.set("datacat/character/", { character: { personality: "Should not be read." } });
    expect(await datacatProvider.fetchDetail(card)).toBeNull();
    expect(api.calls).toEqual(["datacat/download/d1"]);
  });

  it("keeps numeric ids as text in cards, links and detail paths (ruling C)", async () => {
    api.replies.set("janny/search", { results: [{ hits: [{ id: 42, name: "Num" }] }] });
    const [janny] = (await jannyProvider.search(criteria({ sort: "newest" }))).cards;
    expect([janny.id, janny.link]).toEqual(["42", "https://jannyai.com/characters/42_character-num"]);
    api.replies.set("janny/character/", { character: { personality: "p" } });
    await jannyProvider.fetchDetail(janny);
    expect(api.calls.at(-1)).toBe("janny/character/42?slug=character-num");

    api.replies.set("pygmalion/search", { characters: [{ id: 7 }] });
    const [pyg] = (await pygmalionProvider.search(criteria({ sort: "downloads" }))).cards;
    expect([pyg.id, pyg.link]).toEqual(["7", "https://pygmalion.chat/character/7"]);

    api.replies.set("wyvern/search", { results: [{ id: 0 }] });
    expect((await wyvernProvider.search(criteria({ sort: "popular" }))).cards[0].id).toBe("0");

    api.replies.set("datacat/tags", []);
    api.replies.set("datacat/recent", { characters: [{ id: 99, name: "Moth" }] });
    const [datacat] = (await datacatProvider.search(criteria({ sort: "relevance" }))).cards;
    expect([datacat.id, datacat.link]).toEqual(["99", "https://datacat.run/characters/99"]);

    api.replies.set("pygmalion/search", { characters: [{ id: null }, { id: "" }] });
    expect((await pygmalionProvider.search(criteria())).cards.map((card) => card.id)).toEqual(["", ""]);
  });

  it("counts the site's hits for the page before tag checks on this side (ruling D)", async () => {
    api.replies.set("wyvern/search", { results: [{ id: "w1", tags: ["Horror"] }], total: 100 });
    const page = await wyvernProvider.search(criteria({ sort: "popular", excludeTags: ["horror"] }));
    expect([page.cards.length, page.pageHits]).toEqual([0, 1]);
  });

  it("doesn't fail DataCat Fresh over an odd unavailableWindows, and matches thisWeek exactly (fix 1)", async () => {
    api.replies.set("datacat/tags", []);
    for (const unavailableWindows of [{ thisWeek: true }, 3, "thisWeek", ["thisWeekend"], null]) {
      api.replies.set("datacat/fresh", { last24h: [{ id: "f1" }], fallback: { partial: true, unavailableWindows } });
      const page = await datacatProvider.search(criteria({ sort: "fresh" }));
      expect(page.notices, JSON.stringify(unavailableWindows)).toEqual([]);
      expect(page.cards).toHaveLength(1);
    }
  });
});

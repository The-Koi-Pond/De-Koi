// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replies: new Map<string, unknown>(),
  calls: [] as string[],
  importBodies: [] as Array<Record<string, unknown>>,
  importResult: { success: true, characterId: "new-1", name: "Saved Name" } as Record<string, unknown>,
  confirm: vi.fn(async (_name: string, _lorebook: unknown) => true),
}));

vi.mock("../../../../shared/api/bot-browser-command-api", () => ({
  botBrowserCommandApi: {
    get: async (rawPath: string) => {
      const path = rawPath.replace(/^\/bot-browser\//, "");
      mocks.calls.push(path);
      for (const [prefix, value] of mocks.replies) {
        if (path.startsWith(prefix)) {
          if (value instanceof Error) throw value;
          return value;
        }
      }
      throw new Error(`No reply for ${path}`);
    },
    post: async () => {
      throw new Error("No posts expected");
    },
  },
}));

vi.mock("../../../../shared/api/import-api", () => ({
  importApi: {
    stCharacterJson: async (body: Record<string, unknown>) => {
      mocks.importBodies.push(body);
      return mocks.importResult;
    },
  },
}));

vi.mock("../../../../shared/lib/character-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../shared/lib/character-import")>()),
  confirmEmbeddedLorebookImport: mocks.confirm,
}));

import { TINY_PNG_BASE64, tinyPngBytes } from "../test-fixtures/screen-driver";
import { importBrowserCharacter } from "./importing";
import { writeCardIntoPng } from "./png-card";
import { chartavernProvider } from "./providers/chartavern";
import { chubProvider } from "./providers/chub";
import { datacatProvider } from "./providers/datacat";
import { jannyProvider } from "./providers/janny";
import { pygmalionProvider } from "./providers/pygmalion";
import type { BrowserCard, BrowserProvider } from "./providers/types";
import { wyvernProvider } from "./providers/wyvern";

const PICTURE_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function siteCardPng(card: unknown) {
  const bytes = writeCardIntoPng(tinyPngBytes(), card);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { base64: btoa(binary), mimeType: "image/png" };
}

function card(overrides: Partial<BrowserCard> = {}): BrowserCard {
  return {
    id: "maker/lantern",
    name: "Lantern Keeper",
    creator: "maker",
    tagline: "Keeps the light.",
    tags: ["Fantasy", "Calm"],
    picture: null,
    stats: [],
    nsfw: false,
    link: "",
    raw: {},
    ...overrides,
  };
}

const SITE_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Site Name",
    description: "Site description.",
    first_mes: "Site hello.",
    tags: ["site-tag"],
    alternate_greetings: ["Site alt."],
    extensions: { site: true },
  },
};

beforeEach(() => {
  mocks.replies.clear();
  mocks.calls.length = 0;
  mocks.importBodies.length = 0;
  mocks.importResult = { success: true, characterId: "new-1", name: "Saved Name" };
  mocks.confirm.mockClear();
  mocks.confirm.mockResolvedValue(true);
});

describe("PNG imports", () => {
  it("imports ChubAI's card merged with the open detail", async () => {
    mocks.replies.set("chub/download/maker/lantern", siteCardPng(SITE_CARD));
    const outcome = await importBrowserCharacter({
      provider: chubProvider,
      card: card(),
      openDetail: {
        description: "Detail description.",
        firstMessage: "",
        alternateGreetings: [],
        providerExtensions: { chub: { full_path: "maker/lantern" } },
      },
      tagImportMode: "existing",
    });

    expect(mocks.calls).toEqual(["chub/download/maker/lantern"]);
    expect(mocks.confirm).toHaveBeenCalledWith("Lantern Keeper", undefined);
    expect(mocks.importBodies).toEqual([
      {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Lantern Keeper",
          description: "Detail description.",
          first_mes: "Site hello.",
          tags: ["Fantasy", "Calm"],
          creator: "maker",
          alternate_greetings: [],
          extensions: { site: true, chub: { full_path: "maker/lantern" } },
        },
        _avatarDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        _botBrowserSource: "chub:maker/lantern",
        importEmbeddedLorebook: true,
        tagImportMode: "existing",
      },
    ]);
    expect(outcome).toEqual({ result: mocks.importResult, name: "Saved Name", warnings: [] });
  });

  it("fetches ChubAI's detail when none is open, and asks about the card's own lorebook", async () => {
    const lorebook = { entries: [{ keys: ["light"], content: "Always on." }] };
    mocks.replies.set(
      "chub/download/",
      siteCardPng({ ...SITE_CARD, data: { ...SITE_CARD.data, character_book: lorebook } }),
    );
    mocks.replies.set("chub/character/", { data: { node: { definition: { scenario: "A lighthouse." } } } });
    mocks.confirm.mockResolvedValueOnce(false);
    mocks.importResult = { success: true, characterId: "new-2" };

    const outcome = await importBrowserCharacter({
      provider: chubProvider,
      card: card(),
      openDetail: undefined,
      tagImportMode: "all",
    });

    expect(mocks.calls).toEqual(["chub/download/maker/lantern", "chub/character/maker/lantern"]);
    expect(mocks.confirm).toHaveBeenCalledWith("Lantern Keeper", lorebook);
    expect(mocks.importBodies[0]).toMatchObject({
      data: { name: "Lantern Keeper", scenario: "A lighthouse.", character_book: lorebook, alternate_greetings: [] },
      _botBrowserSource: "chub:maker/lantern",
      importEmbeddedLorebook: false,
      tagImportMode: "all",
    });
    expect(outcome.name).toBe("character");
  });

  it("imports ChubAI's card as is when the detail fetch fails", async () => {
    mocks.replies.set("chub/download/", siteCardPng(SITE_CARD));
    mocks.replies.set("chub/character/", new Error("Upstream returned 500"));
    await importBrowserCharacter({
      provider: chubProvider,
      card: card(),
      openDetail: undefined,
      tagImportMode: "none",
    });
    expect(mocks.importBodies[0]).toMatchObject({
      ...SITE_CARD,
      _botBrowserSource: "chub:maker/lantern",
      tagImportMode: "none",
    });
  });

  it("imports CharacterTavern's card with the open detail only, never fetching one", async () => {
    mocks.replies.set("chartavern/download/maker/host", siteCardPng({ name: "Flat Card", description: "Flat." }));
    await importBrowserCharacter({
      provider: chartavernProvider,
      card: card({ id: "maker/host", name: "Host", tags: [] }),
      openDetail: undefined,
      tagImportMode: "all",
    });
    expect(mocks.calls).toEqual(["chartavern/download/maker/host"]);
    expect(mocks.importBodies[0]).toEqual({
      name: "Flat Card",
      description: "Flat.",
      _avatarDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      _botBrowserSource: "chartavern:maker/host",
      importEmbeddedLorebook: true,
      tagImportMode: "all",
    });

    mocks.importBodies.length = 0;
    await importBrowserCharacter({
      provider: chartavernProvider,
      card: card({ id: "maker/host", name: "Host", creator: "maker", tags: ["Ale"] }),
      openDetail: { scenario: "A tavern.", hasLorebook: true },
      tagImportMode: "all",
    });
    expect(mocks.importBodies[0]).toMatchObject({
      name: "Host",
      description: "Flat.",
      scenario: "A tavern.",
      creator: "maker",
      tags: ["Ale"],
    });
  });
});

const BUILT: Array<[string, BrowserProvider]> = [
  ["janny", jannyProvider],
  ["pygmalion", pygmalionProvider],
  ["wyvern", wyvernProvider],
  ["datacat", datacatProvider],
];

describe("built imports", () => {
  for (const [id, provider] of BUILT) {
    it(`builds ${id}'s card from the open detail, with its markers, tag mode and picture`, async () => {
      mocks.replies.set("janny/avatar/", { base64: TINY_PNG_BASE64, mimeType: "image/png" });
      const lorebook = { entries: { 0: { keys: ["a"], content: "b" } } };
      const outcome = await importBrowserCharacter({
        provider,
        card: card({ id: "c-1", picture: "tauri-api:/bot-browser/janny/avatar/c.png" }),
        openDetail: {
          description: "Kind.",
          personality: "Warm.",
          firstMessage: "Hi.",
          exampleDialogs: "<START>",
          alternateGreetings: ["Yo."],
          providerExtensions: { depth_prompt: { prompt: "p" } },
          embeddedLorebook: lorebook,
        },
        tagImportMode: "existing",
      });

      expect(mocks.confirm).toHaveBeenCalledWith("Lantern Keeper", lorebook);
      expect(mocks.importBodies).toEqual([
        {
          name: "Lantern Keeper",
          description: "Kind.",
          personality: "Warm.",
          scenario: "",
          first_mes: "Hi.",
          mes_example: "<START>",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          character_version: "",
          alternate_greetings: ["Yo."],
          tags: ["Fantasy", "Calm"],
          creator: "maker",
          extensions: { depth_prompt: { prompt: "p" }, [id]: { id: "c-1" } },
          character_book: lorebook,
          _botBrowserSource: `${id}:c-1`,
          tagImportMode: "existing",
          importEmbeddedLorebook: true,
          _avatarDataUrl: PICTURE_DATA_URL,
        },
      ]);
      expect(outcome.name).toBe("Saved Name");
    });
  }

  it("moves a lone personality into the description and imports with no detail at all", async () => {
    await importBrowserCharacter({
      provider: wyvernProvider,
      card: card({ id: "w1" }),
      openDetail: { personality: "Only this." },
      tagImportMode: "all",
    });
    expect(mocks.importBodies[0]).toMatchObject({ description: "Only this.", personality: "" });
    expect(mocks.importBodies[0]).not.toHaveProperty("character_book");
    expect(mocks.importBodies[0]).not.toHaveProperty("_avatarDataUrl");

    mocks.importBodies.length = 0;
    mocks.replies.set("pygmalion/character", new Error("Upstream returned 502"));
    mocks.importResult = { success: true };
    const outcome = await importBrowserCharacter({
      provider: pygmalionProvider,
      card: card({ id: "p1" }),
      openDetail: undefined,
      tagImportMode: "none",
    });
    expect(mocks.calls).toEqual(["pygmalion/character?id=p1"]);
    expect(mocks.importBodies[0]).toMatchObject({
      name: "Lantern Keeper",
      description: "",
      first_mes: "",
      alternate_greetings: [],
      extensions: { pygmalion: { id: "p1" } },
      _botBrowserSource: "pygmalion:p1",
    });
    expect(outcome.name).toBe("Lantern Keeper");
  });

  it("imports without the picture when it won't load, and says so (decision 6)", async () => {
    mocks.replies.set("datacat/avatar/", new Error("Upstream returned 404"));
    const outcome = await importBrowserCharacter({
      provider: datacatProvider,
      card: card({ id: "d1", picture: "tauri-api:/bot-browser/datacat/avatar/x.webp" }),
      openDetail: null,
      tagImportMode: "all",
    });
    expect(mocks.importBodies[0]).not.toHaveProperty("_avatarDataUrl");
    expect(outcome.warnings).toEqual(["Imported without its picture: Upstream returned 404"]);
  });

  it("fails with the importer's reason when it refuses", async () => {
    mocks.importResult = { success: false, error: "That card is broken." };
    await expect(
      importBrowserCharacter({ provider: wyvernProvider, card: card(), openDetail: null, tagImportMode: "all" }),
    ).rejects.toThrow("That card is broken.");
    mocks.importResult = { success: false };
    await expect(
      importBrowserCharacter({ provider: wyvernProvider, card: card(), openDetail: null, tagImportMode: "all" }),
    ).rejects.toThrow("Import failed");
  });
});

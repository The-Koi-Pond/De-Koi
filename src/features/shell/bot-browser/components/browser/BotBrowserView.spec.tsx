import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../../../shared/api/api-errors";
import { parsePngCharacterCard } from "../../../../../shared/lib/png-parser";
import { lorebookKeys } from "../../../../catalog/lorebooks/index";
import { BROWSER_SETTINGS_KEY } from "../../lib/browser-settings";
import { resetDatacatTagsForTests } from "../../lib/providers/datacat";
import {
  byPlaceholder,
  changeValue,
  click,
  getAllByRole,
  getByRole,
  labelledField,
  mount,
  queryByRole,
  QuietIntersectionObserver,
  settle,
  tinyPngBytes,
  type Mounted,
  type SentRequest,
} from "../../test-fixtures/screen-driver";
import { BotBrowserView } from "./BotBrowserView";

type Handler = (request: SentRequest) => unknown;

const mocks = vi.hoisted(() => ({
  sent: [] as SentRequest[],
  handler: null as null | ((request: SentRequest) => unknown),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  importBodies: [] as Array<Record<string, unknown>>,
  importResult: {} as Record<string, unknown>,
  cacheRecord: vi.fn((..._args: unknown[]) => true),
  invalidateCharacters: vi.fn(),
  offerCardLint: vi.fn(async (_result: unknown) => undefined),
  importRegex: vi.fn(async (_result: unknown) => 0),
  savedFiles: [] as Array<{ filename: string; blob: Blob; title?: string }>,
  saveResult: "saved" as "saved" | "downloaded" | "cancelled",
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("../../../../../shared/api/bot-browser-command-api", () => {
  const handle = async (request: SentRequest) => {
    mocks.sent.push(request);
    if (!mocks.handler) throw new Error("No handler");
    return mocks.handler(request);
  };
  const prefixed = (path: string) => (path.startsWith("/bot-browser/") ? path : `/bot-browser/${path}`);
  return {
    botBrowserCommandApi: {
      get: (path: string) => handle({ command: "bot_browser_get", path: prefixed(path) }),
      post: (path: string, body?: unknown) =>
        handle({ command: "bot_browser_post", path: prefixed(path), body: body ?? null }),
    },
  };
});

vi.mock("../../../../../shared/api/import-api", () => ({
  importApi: {
    stCharacterJson: async (body: Record<string, unknown>) => {
      mocks.importBodies.push(body);
      return mocks.importResult;
    },
  },
}));

vi.mock("../../../../catalog/characters/index", () => ({
  cacheCharacterListRecordFromResult: mocks.cacheRecord,
  invalidateCharacterCollectionQueries: mocks.invalidateCharacters,
  offerCardLintReview: mocks.offerCardLint,
}));

vi.mock("../../../../../shared/lib/regex-script-import", () => ({
  importRegexScriptsForCharacter: mocks.importRegex,
}));

vi.mock("../../lib/redraw-png", () => ({ redrawPictureAsPng: async () => tinyPngBytes() }));

vi.mock("../../../../../shared/api/file-save-api", () => ({
  saveFileToUserSelectedLocation: async (options: { filename: string; blob: Blob; title?: string }) => {
    mocks.savedFiles.push(options);
    return mocks.saveResult;
  },
}));

const localOf = (request: SentRequest) => request.path.replace(/^\/bot-browser\//, "");

function chubNode(fullPath: string, name: string) {
  return { fullPath, name, tagline: `${name} tagline`, topics: ["Calm"], starCount: 1234, nChats: 5, nsfw: true };
}

/** A site where every route answers with something small and ordinary. */
function quietSite(overrides: Record<string, unknown> = {}): Handler {
  return (request) => {
    const local = localOf(request);
    for (const [prefix, value] of Object.entries(overrides)) {
      if (local.startsWith(prefix)) {
        if (value instanceof Error) throw value;
        return typeof value === "function" ? (value as Handler)(request) : value;
      }
    }
    if (local.endsWith("/session")) return { active: false };
    if (local.startsWith("chub/search")) return { data: { nodes: [chubNode("ink/keeper", "Keeper")], cursor: "x" } };
    if (local.startsWith("chub/character/")) return { data: { node: { definition: { personality: "Steady." } } } };
    if (local.includes("/avatar/")) return { base64: "", mimeType: "image/png" };
    if (local.startsWith("pygmalion/search")) return { characters: [{ id: "p1", displayName: "Gardener" }] };
    if (local.startsWith("chartavern/search")) return { hits: [{ path: "maker/host", name: "Host" }] };
    if (local === "datacat/tags") return [];
    if (local.startsWith("datacat/recent")) return { characters: [{ id: "d1", name: "Moth" }] };
    throw new Error(`No reply for ${request.path}`);
  };
}

function searches(prefix = "chub/search") {
  return mocks.sent.filter((request) => localOf(request).startsWith(prefix)).map((request) => localOf(request));
}

function tiles() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("main ul > li > button"));
}

async function openBrowser() {
  mounted = await mount(<BotBrowserView />);
  await settle();
  return mounted;
}

async function pickProvider(current: string, next: string) {
  await click(getByRole("button", current));
  await click(getByRole("menuitemradio", next));
  await settle();
}

let mounted: Mounted | null = null;

beforeEach(() => {
  mocks.sent.length = 0;
  mocks.handler = quietSite();
  mocks.importBodies.length = 0;
  mocks.importResult = {
    success: true,
    characterId: "char-1",
    name: "Keeper",
    character: { id: "char-1", data: { name: "Keeper" } },
    lorebook: null,
  };
  mocks.savedFiles.length = 0;
  mocks.saveResult = "saved";
  for (const fn of Object.values(mocks.toast)) fn.mockClear();
  mocks.cacheRecord.mockClear().mockReturnValue(true);
  mocks.invalidateCharacters.mockClear();
  mocks.offerCardLint.mockClear().mockResolvedValue(undefined);
  mocks.importRegex.mockClear().mockResolvedValue(0);
  window.localStorage.clear();
  resetDatacatTagsForTests();
  vi.stubGlobal("IntersectionObserver", QuietIntersectionObserver);
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("Bot Browser screen", () => {
  it("opens on ChubAI's most downloaded and shows each card as a button with its picture", async () => {
    await openBrowser();
    expect((getByRole("combobox", "Sort") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Most downloaded");
    expect(byPlaceholder("Search characters").getAttribute("placeholder")).toMatch(/^Search characters/);
    const [tile] = tiles();
    expect(tile.textContent).toContain("Keeper");
    expect(tile.textContent).toContain("by ink");
    expect(tile.textContent).toContain("NSFW");
    expect(tile.textContent).toContain("1.2K");
    expect(tile.querySelector("[title='Stars']")).not.toBeNull();
    // The picture waits for the tile to scroll into view; the placeholder holds its place inside the tile.
    expect(tile.querySelector("span[aria-hidden='true'], img")).not.toBeNull();
  });

  it("never lets an older reply replace a newer one", async () => {
    const replies: Record<string, (value: unknown) => void> = {};
    mocks.handler = quietSite({
      "chub/search": (request: SentRequest) =>
        new Promise((resolve) => {
          replies[localOf(request).includes("page=2") ? "page2" : "page1"] = resolve;
        }),
    });
    await openBrowser();
    replies.page1({ data: { nodes: [chubNode("a/first", "First")], cursor: "x" } });
    await settle();
    await click(getByRole("button", "Next"));
    const slowPage2 = replies.page2;
    await click(getByRole("button", "Previous"));
    await settle();
    replies.page1({ data: { nodes: [chubNode("a/newest", "Newest")], cursor: "x" } });
    await settle();
    slowPage2({ data: { nodes: [chubNode("a/stale", "Stale")], cursor: "x" } });
    await settle();
    expect(tiles().map((tile) => tile.textContent)).toEqual([expect.stringContaining("Newest")]);
  });

  it("shows a failed search's reason with Retry, and an empty page", async () => {
    mocks.handler = quietSite({ "chub/search": new Error("socket closed") });
    await openBrowser();
    expect(getByRole("alert").textContent).toContain(
      "Search didn't finish. Check your internet connection, then try again.",
    );
    mocks.handler = quietSite({ "chub/search": { nodes: [] } });
    await click(getByRole("button", "Retry"));
    await settle();
    expect(document.body.textContent).toContain("No characters found");
  });

  it("goes back to page 1 when the search is cleared (decision 9)", async () => {
    await openBrowser();
    await changeValue(byPlaceholder("Search characters"), "elf");
    await settle(150);
    await click(getByRole("button", "Next"));
    await settle(150);
    expect(searches().at(-1)).toContain("page=2");
    await click(getByRole("button", "Clear search"));
    await settle();
    expect(searches().at(-1)).toBe("chub/search?q=&page=1&nsfw=false&sort=download_count");
  });

  it("stops Next on a page that came back empty (decision 13)", async () => {
    mocks.handler = quietSite({
      "chub/search": (request: SentRequest) =>
        localOf(request).includes("page=2")
          ? { nodes: [] }
          : { data: { nodes: [chubNode("ink/keeper", "Keeper")], cursor: "x" } },
    });
    await openBrowser();
    await click(getByRole("button", "Next"));
    await settle();
    expect(getByRole("button", "Next").hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("Page 2");
  });

  it("opens even when the saved settings are broken (decision 5)", async () => {
    window.localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify({ nsfw: null, logins: 7, lastSource: "chub" }));
    await openBrowser();
    expect(tiles()).toHaveLength(1);
    await click(getByRole("switch"));
    await settle();
    expect(JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}")).toEqual({
      nsfw: { chub: true },
      logins: {},
      lastSource: "chub",
    });
    expect(searches().at(-1)).toContain("nsfw=true");
  });
});

describe("character detail", () => {
  it("shows the detail's sections, and a failed fetch's reason with Retry", async () => {
    mocks.handler = quietSite({ "chub/character/": new Error("timeout") });
    await openBrowser();
    await click(tiles()[0]);
    await settle();
    expect(getByRole("alert").textContent).toContain("Couldn't load this character.");
    expect(queryByRole("button", "Import")).toBeNull();

    mocks.handler = quietSite({
      "chub/character/": {
        data: {
          node: {
            definition: {
              description: "Notes here.",
              personality: "Steady.",
              alternate_greetings: ["Hi.", "Hello."],
              embedded_lorebook: { entries: [{ keys: ["k"], content: "c" }] },
            },
          },
        },
      },
    });
    await click(getByRole("button", "Retry"));
    await settle();
    const text = document.querySelector("article")?.textContent ?? "";
    expect(text).toContain("Creator's notes");
    expect(text).toContain("Alternate greetings (2)");
    expect(text).toContain("Has embedded lorebook");
    expect(getByRole("button", "Import")).toBeTruthy();
    await click(getByRole("button", "Back to results"));
    expect(tiles()).toHaveLength(1);
  });

  it("never shows or imports one character's detail on another (decision 1)", async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    mocks.handler = quietSite({
      "chub/search": {
        data: { nodes: [chubNode("ink/first", "First"), chubNode("ink/second", "Second")], cursor: null },
      },
      "chub/character/": (request: SentRequest) =>
        new Promise((resolve) => {
          pending[localOf(request)] = resolve;
        }),
      "chub/download/": { base64: btoa("not a png"), mimeType: "image/png" },
    });
    await openBrowser();
    await click(tiles()[0]);
    await click(getByRole("button", "Back to results"));
    await click(tiles()[1]);
    pending["chub/character/ink/first"]({ data: { node: { definition: { personality: "First's words." } } } });
    await settle();
    expect(document.querySelector("article")?.textContent).not.toContain("First's words.");
    pending["chub/character/ink/second"]({ data: { node: { definition: { personality: "Second's words." } } } });
    await settle();
    expect(document.querySelector("article")?.textContent).toContain("Second's words.");
  });
});

describe("importing", () => {
  it("imports a built card and refreshes what depends on it", async () => {
    mocks.handler = quietSite({
      "pygmalion/character": { character: { personality: { persona: "Patient." } } },
    });
    mocks.importResult = { ...mocks.importResult, name: "Gardener", lorebook: { lorebookId: "lb-1" } };
    const { queryClient } = await openBrowser();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await pickProvider("ChubAI", "Pygmalion");
    await click(tiles()[0]);
    await settle();
    await click(labelledField<HTMLInputElement>("No tags"));
    await click(getByRole("button", "Import"));
    await settle();

    expect(mocks.importBodies).toEqual([
      expect.objectContaining({
        name: "Gardener",
        description: "Patient.",
        extensions: { pygmalion: { id: "p1" } },
        _botBrowserSource: "pygmalion:p1",
        tagImportMode: "none",
        importEmbeddedLorebook: true,
      }),
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Imported "Gardener" successfully!');
    expect(mocks.cacheRecord).toHaveBeenCalledWith(queryClient, mocks.importResult);
    expect(mocks.invalidateCharacters).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: lorebookKeys.all });
    expect(mocks.offerCardLint).toHaveBeenCalledWith(mocks.importResult);
    expect(mocks.importRegex).toHaveBeenCalledWith({ characterId: "char-1", character: mocks.importResult.character });
  });

  it("invalidates the lists when the cache can't take the record and warns about regex scripts that fail", async () => {
    mocks.cacheRecord.mockReturnValue(false);
    mocks.importRegex.mockRejectedValue(new Error("storage is full"));
    mocks.handler = quietSite({ "pygmalion/character": { character: {} } });
    await openBrowser();
    await pickProvider("ChubAI", "Pygmalion");
    await click(tiles()[0]);
    await settle();
    expect(document.body.textContent).toContain("No detailed definition available.");
    await click(getByRole("button", "Import"));
    await settle();
    expect(mocks.invalidateCharacters).toHaveBeenCalled();
    expect(mocks.toast.warning).toHaveBeenCalledWith("Couldn't import its regex scripts: storage is full");
  });

  it("toasts the reason when an import fails", async () => {
    mocks.importResult = { success: false, error: "The card has no name." };
    mocks.handler = quietSite({ "pygmalion/character": { character: {} } });
    await openBrowser();
    await pickProvider("ChubAI", "Pygmalion");
    await click(tiles()[0]);
    await settle();
    await click(getByRole("button", "Import"));
    await settle();
    expect(mocks.toast.error).toHaveBeenCalledWith("The card has no name.");
  });
});

describe("Download as PNG", () => {
  it("saves a card that opens with the detail's fields", async () => {
    mocks.handler = quietSite({
      "chub/character/": { data: { node: { definition: { personality: "Steady.", first_message: "Hello." } } } },
    });
    await openBrowser();
    await click(tiles()[0]);
    await settle();
    await click(getByRole("button", "Download as PNG"));
    await settle();

    expect(mocks.savedFiles).toHaveLength(1);
    expect(mocks.savedFiles[0]).toMatchObject({ filename: "Keeper.png", title: "Export character PNG" });
    const { json } = await parsePngCharacterCard(new File([mocks.savedFiles[0].blob], "Keeper.png"));
    expect(json).toMatchObject({
      spec: "chara_card_v2",
      data: { name: "Keeper", description: "Steady.", first_mes: "Hello.", extensions: { chub: { id: "ink/keeper" } } },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Saved "Keeper" as PNG character card!');
  });

  it("is disabled with a reason when the character has no picture (decision 3)", async () => {
    mocks.handler = quietSite({
      "pygmalion/character": { character: {} },
    });
    await openBrowser();
    await pickProvider("ChubAI", "Pygmalion");
    await click(tiles()[0]);
    await settle();
    const button = getByRole("button", "Download as PNG");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("This character has no picture to build a PNG from.");
  });
});

describe("logins", () => {
  it("logs in to Pygmalion, turns NSFW on and saves the login", async () => {
    mocks.handler = quietSite({
      "pygmalion/set-token": { ok: true },
      "pygmalion/validate": { valid: true },
      "pygmalion/logout": { ok: true },
    });
    await openBrowser();
    await pickProvider("ChubAI", "Pygmalion");
    await click(getByRole("button", "Log in"));
    expect(getByRole("dialog").textContent).toContain("Pygmalion authentication");
    await changeValue(byPlaceholder<HTMLTextAreaElement>("Paste your Pygmalion auth token"), " tok-123 ");
    await click(getByRole("button", "Save & connect"));
    await settle();

    expect(mocks.sent.filter((request) => request.command === "bot_browser_post")).toEqual([
      { command: "bot_browser_post", path: "/bot-browser/pygmalion/set-token", body: { token: " tok-123 " } },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Logged in to Pygmalion! NSFW content enabled.");
    expect(queryByRole("dialog")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}")).toEqual({
      nsfw: { pygmalion: true },
      logins: { pygmalion: true },
    });
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(getByRole("switch").textContent).toContain("NSFW (account)");
    expect(searches("pygmalion/search").at(-1)).toContain("includeSensitive=true");

    await click(getByRole("button", "Log out"));
    await settle();
    expect(mocks.sent.filter((request) => request.command === "bot_browser_post").at(-1)).toEqual({
      command: "bot_browser_post",
      path: "/bot-browser/pygmalion/logout",
      body: null,
    });
    expect(searches("pygmalion/search").at(-1)).not.toContain("includeSensitive");
    expect(mocks.toast.success).toHaveBeenCalledWith("Logged out of Pygmalion.");
    expect(JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}")).toEqual({
      nsfw: { pygmalion: false },
      logins: { pygmalion: false },
    });
  });

  it("toasts why a login failed and keeps the dialog open", async () => {
    mocks.handler = quietSite({
      "chartavern/set-cookie": { ok: true },
      "chartavern/validate": { valid: false, reason: "Session rejected/expired by server" },
    });
    await openBrowser();
    await pickProvider("ChubAI", "CharacterTavern");
    await click(getByRole("switch"));
    expect(getByRole("dialog").textContent).toContain("CharacterTavern session");
    await changeValue(byPlaceholder<HTMLTextAreaElement>("Paste your session cookie"), "abc");
    await click(getByRole("button", "Save & connect"));
    await settle();
    expect(mocks.toast.error).toHaveBeenCalledWith("Session rejected/expired by server");
    expect(getByRole("dialog")).toBeTruthy();

    mocks.handler = quietSite({
      "chartavern/set-cookie": new ApiError("Invalid cookie value. Paste only the session cookie value.", 400, {
        code: "invalid_input",
      }),
    });
    await click(getByRole("button", "Save & connect"));
    await settle();
    expect(mocks.toast.error).toHaveBeenLastCalledWith("Invalid cookie value. Paste only the session cookie value.");

    mocks.handler = quietSite({
      "chartavern/set-cookie": { ok: true },
      "chartavern/validate": { valid: true, hasNsfw: true },
    });
    await click(getByRole("button", "Save & connect"));
    await settle();
    expect(mocks.toast.success).toHaveBeenCalledWith("Logged in to CharacterTavern! NSFW content detected.");
    expect(document.body.textContent).toContain("Session active");
  });

  it("keeps the login when logging out fails, and says so (decision 7)", async () => {
    window.localStorage.setItem(
      BROWSER_SETTINGS_KEY,
      JSON.stringify({ nsfw: { pygmalion: true }, logins: { pygmalion: true } }),
    );
    mocks.handler = quietSite({
      "pygmalion/session": { active: true, hasToken: true },
      "pygmalion/logout": new Error("disk locked"),
    });
    await openBrowser();
    await pickProvider("ChubAI", "Pygmalion");
    expect(document.body.textContent).toContain("Logged in");
    await click(getByRole("button", "Log out"));
    await settle();
    expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't log out of Pygmalion. Try again.");
    expect(JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}").logins).toEqual({ pygmalion: true });
  });

  it("says when a saved login's session has expired, and leaves the flag alone when the check fails", async () => {
    window.localStorage.setItem(
      BROWSER_SETTINGS_KEY,
      JSON.stringify({ nsfw: {}, logins: { pygmalion: true, chartavern: true } }),
    );
    mocks.handler = quietSite({
      "pygmalion/session": { active: false, hasToken: false },
      "chartavern/session": new Error("offline"),
    });
    await openBrowser();
    expect(mocks.toast.warning).toHaveBeenCalledWith("Pygmalion session expired — please log in again.");
    expect(JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "{}").logins).toEqual({
      pygmalion: false,
      chartavern: true,
    });
  });
});

describe("DataCat", () => {
  it("warns once per session; cancelling stays put", async () => {
    await openBrowser();
    await click(getByRole("button", "ChubAI"));
    await click(getByRole("menuitemradio", "DataCat"));
    expect(getByRole("dialog").textContent).toContain("Every character on DataCat is tagged NSFW upstream");
    await click(getByRole("button", "Don't continue to DataCat"));
    expect(queryByRole("dialog")).toBeNull();
    expect(getByRole("button", "ChubAI")).toBeTruthy();

    await click(getByRole("button", "ChubAI"));
    await click(getByRole("menuitemradio", "DataCat"));
    await click(getByRole("button", "Continue to DataCat"));
    await settle();
    expect(getByRole("button", "DataCat")).toBeTruthy();
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(getByRole("switch").hasAttribute("disabled")).toBe(true);

    await pickProvider("DataCat", "ChubAI");
    await pickProvider("ChubAI", "DataCat");
    expect(queryByRole("dialog")).toBeNull();
    expect(getByRole("button", "DataCat")).toBeTruthy();
    expect(getAllByRole("menuitemradio")).toHaveLength(0);
  });
});

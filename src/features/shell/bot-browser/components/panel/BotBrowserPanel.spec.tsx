import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  changeValue,
  click,
  getAllByRole,
  getByRole,
  mount,
  settle,
  type Mounted,
} from "../../test-fixtures/screen-driver";
import { BotBrowserPanel } from "./BotBrowserPanel";

const mocks = vi.hoisted(() => ({
  summaries: [] as Array<Record<string, unknown>>,
  loading: false,
  startChat: vi.fn(),
  storageGet: vi.fn(),
}));

vi.mock("../../../../catalog/characters/index", () => ({
  useCharacterSummaries: () => ({ data: mocks.summaries, isLoading: mocks.loading }),
  useStartChatFromCharacter: () => ({ startChatFromCharacter: mocks.startChat, isStartingChat: false }),
  characterAvatarUrl: (summary: { avatarPath?: string | null }) => summary.avatarPath ?? null,
  CharacterAvatarImage: ({ src, alt }: { src?: string | null; alt: string }) => <img src={src ?? ""} alt={alt} />,
}));

vi.mock("../../../../../shared/api/storage-api", () => ({ storageApi: { get: mocks.storageGet } }));

let mounted: Mounted | null = null;
const openCharacterDetail = vi.fn();
const openBotBrowser = vi.fn();

beforeEach(() => {
  mocks.loading = false;
  mocks.startChat.mockClear();
  openCharacterDetail.mockClear();
  openBotBrowser.mockClear();
  useUIStore.setState({ botBrowserOpen: false, openCharacterDetail, openBotBrowser });
  mocks.summaries = [
    {
      id: "c1",
      data: { name: "Lantern Keeper", extensions: { botBrowserSource: "chub:ink/keeper" } },
      avatarPath: "/a.png",
    },
    { id: "c2", data: { name: "Old Import", extensions: {} } },
    { id: "c3", data: JSON.stringify({ name: "", extensions: { botBrowserSource: "janny:abc", avatarCrop: {} } }) },
    { id: "c4", data: { name: "Moth", extensions: { botBrowserSource: "datacat:d1" } } },
  ];
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

function rowNames() {
  return Array.from(document.querySelectorAll("ul[aria-label='Imported characters'] > li")).map((row) =>
    row.textContent?.trim(),
  );
}

describe("Bot Browser panel", () => {
  it("lists only characters imported through the Browser, in order, and opens them", async () => {
    mounted = await mount(<BotBrowserPanel />);
    expect(rowNames()).toEqual(["Lantern Keeper", "Unnamed", "Moth"]);
    await click(getByRole("button", "Lantern Keeper"));
    expect(openCharacterDetail).toHaveBeenCalledWith("c1");
    await click(getByRole("button", "Browse online"));
    expect(openBotBrowser).toHaveBeenCalled();
  });

  it("filters by name and says when nothing matches", async () => {
    mounted = await mount(<BotBrowserPanel />);
    await changeValue(document.querySelector<HTMLInputElement>("input[placeholder='Search imported...']")!, "MOTH");
    expect(rowNames()).toEqual(["Moth"]);
    await changeValue(document.querySelector<HTMLInputElement>("input[placeholder='Search imported...']")!, "zzz");
    expect(document.body.textContent).toContain("No matches");
  });

  it("shows loading and empty states", async () => {
    mocks.loading = true;
    mounted = await mount(<BotBrowserPanel />);
    expect(document.body.textContent).toContain("Loading...");
    await mounted.unmount();
    mocks.loading = false;
    mocks.summaries = [];
    mounted = await mount(<BotBrowserPanel />);
    expect(document.body.textContent).toContain("No imported characters yet");
  });

  it("starts a roleplay or a conversation from the More menu or a right-click, with no greeting lookup (decision 12)", async () => {
    mounted = await mount(<BotBrowserPanel />);
    await click(getByRole("button", "More for Moth"));
    await settle();
    await click(getByRole("menuitem", "Quick start roleplay"));
    expect(mocks.startChat).toHaveBeenCalledWith({ characterId: "c4", characterName: "Moth", mode: "roleplay" });

    const row = document.querySelector("ul[aria-label='Imported characters'] > li")!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    await settle();
    expect(getAllByRole("menuitem")).toHaveLength(2);
    await click(getByRole("menuitem", "Quick start conversation"));
    expect(mocks.startChat).toHaveBeenLastCalledWith({
      characterId: "c1",
      characterName: "Lantern Keeper",
      mode: "conversation",
    });
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { HudWidget } from "../../../../engine/contracts/types/game";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { chatKeys } from "../../../catalog/chats/index";
import { gameApi } from "../api/game-api";
import {
  flushPendingGameMetadataPatches,
  persistGameMetadataPatch,
} from "../lib/game-metadata-persistence";
import { useGameSurfacePersistenceController } from "./use-game-surface-persistence-controller";

const patchFieldMock = vi.hoisted(() => vi.fn());
const flushPatchMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../../../runtime/world-state/index", () => ({
  useGameStatePatcher: () => ({
    patchField: patchFieldMock,
    flushPatch: flushPatchMock,
  }),
}));

vi.mock("../api/game-api", () => ({
  gameApi: {
    addJournalEntry: vi.fn(async () => ({ sessionChat: null })),
  },
}));

vi.mock("../lib/game-metadata-persistence", () => ({
  flushPendingGameMetadataPatches: vi.fn(async () => null),
  persistGameMetadataPatch: vi.fn(async () => null),
}));

type PersistenceController = ReturnType<typeof useGameSurfacePersistenceController>;

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    title: "Game Chat",
    mode: "game",
    characterIds: [],
    metadata: {},
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    ...overrides,
  } as Chat;
}

function PersistenceControllerProbe({
  currentLocation,
  onReady,
}: {
  currentLocation?: string | null;
  onReady: (controller: PersistenceController) => void;
}) {
  const controller = useGameSurfacePersistenceController({
    activeChatId: "chat-1",
    currentLocation,
  });

  useEffect(() => {
    onReady(controller);
  }, [controller, onReady]);

  return null;
}

describe("useGameSurfacePersistenceController", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let controller: PersistenceController | null = null;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    useChatStore.getState().reset();
    controller = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    queryClient.clear();
    useChatStore.getState().reset();
  });

  async function renderProbe(currentLocation?: string | null) {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient}>
          <PersistenceControllerProbe
            currentLocation={currentLocation}
            onReady={(nextController) => {
              controller = nextController;
            }}
          />
        </QueryClientProvider>,
      );
    });
  }

  it("publishes session chat rows into the query cache and active chat store", async () => {
    useChatStore.getState().setActiveChatId("chat-1");
    const sessionChat = chat({ metadata: { gameActiveState: "exploration" } as unknown as Chat["metadata"] });

    await renderProbe();
    act(() => {
      controller?.publishSessionChat(sessionChat);
    });

    expect(queryClient.getQueryData(chatKeys.detail("chat-1"))).toEqual(sessionChat);
    expect(useChatStore.getState().activeChat).toEqual(sessionChat);
  });

  it("keeps HUD widget metadata synchronized in cached and active chat rows", async () => {
    const initialChat = chat({ metadata: { gameActiveState: "exploration" } as unknown as Chat["metadata"] });
    const widgets: HudWidget[] = [
      {
        id: "party",
        type: "stat_block",
        label: "Party",
        position: "hud_left",
        config: { stats: [{ name: "Status", value: "Ready" }] },
      },
    ];
    queryClient.setQueryData(chatKeys.detail("chat-1"), initialChat);
    useChatStore.getState().setActiveChatId("chat-1");
    useChatStore.getState().setActiveChat(initialChat);

    await renderProbe();
    act(() => {
      controller?.syncHudWidgetsToChatCache(widgets);
    });

    expect(queryClient.getQueryData<Chat>(chatKeys.detail("chat-1"))?.metadata).toMatchObject({
      gameActiveState: "exploration",
      gameWidgetState: widgets,
    });
    expect(useChatStore.getState().activeChat?.metadata).toMatchObject({
      gameActiveState: "exploration",
      gameWidgetState: widgets,
    });
  });

  it("flushes pending metadata and journals each new location once", async () => {
    await renderProbe("Moon Gate");

    expect(flushPendingGameMetadataPatches).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ onPersisted: expect.any(Function) }),
    );
    expect(gameApi.addJournalEntry).toHaveBeenCalledTimes(1);
    expect(gameApi.addJournalEntry).toHaveBeenCalledWith({
      chatId: "chat-1",
      type: "location",
      data: { location: "Moon Gate", description: "The party is at Moon Gate." },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <PersistenceControllerProbe
            currentLocation="Moon Gate"
            onReady={(nextController) => {
              controller = nextController;
            }}
          />
        </QueryClientProvider>,
      );
    });

    expect(gameApi.addJournalEntry).toHaveBeenCalledTimes(1);
  });

  it("wraps visible game-state patches with the game surface patcher", async () => {
    await renderProbe();

    await act(async () => {
      await controller?.patchVisibleGameState("time", "Day 1, 08:00");
    });

    expect(patchFieldMock).toHaveBeenCalledWith("time", "Day 1, 08:00");
    expect(flushPatchMock).toHaveBeenCalledTimes(1);
  });

  it("persists metadata through the queued game metadata helper", async () => {
    await renderProbe();

    await act(async () => {
      await controller?.persistMetadata("chat-1", { gameCombatState: null });
    });

    expect(persistGameMetadataPatch).toHaveBeenCalledWith(
      "chat-1",
      { gameCombatState: null },
      expect.objectContaining({ onPersisted: expect.any(Function) }),
    );
  });
});

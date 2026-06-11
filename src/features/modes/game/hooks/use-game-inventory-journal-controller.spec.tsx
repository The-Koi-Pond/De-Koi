import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, PlayerStats } from "../../../../engine/contracts/types/game-state";
import {
  useGameStateStore,
  type GameStatePatchField,
  type GameStatePatchValue,
} from "../../../runtime/world-state/index";
import type { InventoryTag } from "../lib/game-tag-parser";
import { gameApi } from "../api/game-api";
import { useGameInventoryJournalController } from "./use-game-inventory-journal-controller";

vi.mock("../api/game-api", () => ({
  gameApi: {
    addJournalEntry: vi.fn(async () => ({ sessionChat: null })),
  },
}));

type ApplyInventoryUpdates = (updates: InventoryTag[]) => Promise<boolean>;
type PatchVisibleGameState = <K extends GameStatePatchField>(
  field: K,
  value: GameStatePatchValue[K],
) => Promise<unknown>;

function createPlayerStats(): PlayerStats {
  return {
    activeQuests: [],
    attributes: null,
    inventory: [],
    skills: {},
    stats: [],
    status: "",
  };
}

function InventoryControllerProbe({
  patchVisibleGameState,
  persistMetadata,
  onReady,
}: {
  patchVisibleGameState: PatchVisibleGameState;
  persistMetadata: (chatId: string, patch: Record<string, unknown>) => Promise<unknown>;
  onReady: (applyInventoryUpdates: ApplyInventoryUpdates) => void;
}) {
  const controller = useGameInventoryJournalController({
    activeChatId: "chat-1",
    chatMeta: { gameInventory: [] },
    sceneRuntimeScopeKey: "chat-1:game-1",
    patchVisibleGameState,
    persistMetadata,
    publishSessionChat: vi.fn(),
  });

  useEffect(() => {
    onReady(controller.applyInventoryUpdates);
  }, [controller.applyInventoryUpdates, onReady]);

  return null;
}

describe("useGameInventoryJournalController persistence", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let previousPlayerStats: PlayerStats;

  beforeEach(() => {
    previousPlayerStats = createPlayerStats();
    useGameStateStore.getState().setGameState({
      chatId: "chat-1",
      committed: false,
      createdAt: "2026-06-11T00:00:00.000Z",
      date: null,
      id: "game-state-1",
      location: null,
      manualOverrides: null,
      messageId: "message-1",
      personaStats: null,
      playerStats: previousPlayerStats,
      presentCharacters: [],
      recentEvents: [],
      swipeIndex: 0,
      temperature: null,
      time: null,
      weather: null,
    });
    vi.mocked(gameApi.addJournalEntry).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    useGameStateStore.getState().reset();
    vi.clearAllMocks();
  });

  it("rolls visible player stats back when compact metadata persistence fails", async () => {
    const persistMetadata = vi.fn(async () => {
      throw new Error("metadata failed");
    });
    const patchVisibleGameStateMock = vi.fn(
      async (field: GameStatePatchField, value: GameStatePatchValue[GameStatePatchField]) => {
        const current = useGameStateStore.getState().current;
        useGameStateStore.getState().setGameState(current ? ({ ...current, [field]: value } as GameState) : null);
      },
    );
    const patchVisibleGameState = patchVisibleGameStateMock as PatchVisibleGameState;
    let applyInventoryUpdates: ApplyInventoryUpdates | null = null;

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <InventoryControllerProbe
          patchVisibleGameState={patchVisibleGameState}
          persistMetadata={persistMetadata}
          onReady={(apply) => {
            applyInventoryUpdates = apply;
          }}
        />,
      );
    });

    let applied = true;
    await act(async () => {
      applied = (await applyInventoryUpdates?.([{ action: "add", items: ["Iron Key"] }])) ?? true;
    });

    expect(applied).toBe(false);
    expect(patchVisibleGameStateMock).toHaveBeenCalledTimes(2);
    expect(persistMetadata).toHaveBeenCalledTimes(1);
    expect(patchVisibleGameStateMock.mock.invocationCallOrder[0]).toBeLessThan(
      persistMetadata.mock.invocationCallOrder[0]!,
    );
    expect(useGameStateStore.getState().current?.playerStats?.inventory).toEqual([]);
    expect(gameApi.addJournalEntry).not.toHaveBeenCalled();
  });
});

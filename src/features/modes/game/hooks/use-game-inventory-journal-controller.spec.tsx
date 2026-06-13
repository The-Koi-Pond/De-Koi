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
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let previousPlayerStats: PlayerStats;

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    consoleWarn.mockRestore();
    vi.clearAllMocks();
  });

  it("does not patch visible player stats when compact metadata persistence fails", async () => {
    const persistMetadata = vi.fn(async () => {
      throw new Error("metadata failed");
    });
    const patchVisibleGameStateMock = vi.fn(async () => {});
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
    expect(persistMetadata).toHaveBeenCalledTimes(1);
    expect(patchVisibleGameStateMock).not.toHaveBeenCalled();
    expect(useGameStateStore.getState().current?.playerStats?.inventory).toEqual([]);
    expect(gameApi.addJournalEntry).not.toHaveBeenCalled();
  });

  it("keeps local player stats converged when visible patch flushing rejects after compact metadata persists", async () => {
    const persistMetadata = vi.fn(async () => null);
    const patchVisibleGameStateMock = vi.fn(async () => {
      throw new Error("game-state flush failed");
    });
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

    let applied = false;
    await act(async () => {
      applied = (await applyInventoryUpdates?.([{ action: "add", items: ["Iron Key"] }])) ?? false;
    });

    expect(applied).toBe(true);
    expect(persistMetadata).toHaveBeenCalledWith("chat-1", { gameInventory: [{ name: "Iron Key", quantity: 1 }] });
    expect(patchVisibleGameStateMock).toHaveBeenCalledTimes(1);
    expect(useGameStateStore.getState().current?.playerStats?.inventory).toMatchObject([
      {
        name: "Iron Key",
        description: "",
        quantity: 1,
        location: "on_person",
      },
    ]);
    expect(useGameStateStore.getState().current?.playerStats?.inventory[0]?.inventoryItemId).toMatch(/^manual-/);
  });

  it("persists compact metadata and detailed player stats once on success", async () => {
    const persistMetadata = vi.fn(async () => null);
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

    let applied = false;
    await act(async () => {
      applied = (await applyInventoryUpdates?.([{ action: "add", items: ["Iron Key"] }])) ?? false;
    });

    expect(applied).toBe(true);
    expect(persistMetadata).toHaveBeenCalledTimes(1);
    expect(patchVisibleGameStateMock).toHaveBeenCalledTimes(1);
    expect(persistMetadata).toHaveBeenCalledWith("chat-1", { gameInventory: [{ name: "Iron Key", quantity: 1 }] });
    expect(patchVisibleGameStateMock).toHaveBeenCalledWith(
      "playerStats",
      expect.objectContaining({
        inventory: [
          expect.objectContaining({
            name: "Iron Key",
            description: "",
            quantity: 1,
            location: "on_person",
          }),
        ],
      }),
    );
  });

  it("applies inventory tag counts to metadata, player stats, and journal quantity", async () => {
    const persistMetadata = vi.fn(async () => null);
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

    let applied = false;
    await act(async () => {
      applied = (await applyInventoryUpdates?.([{ action: "add", items: ["Potion"], count: 3 }])) ?? false;
    });

    expect(applied).toBe(true);
    expect(persistMetadata).toHaveBeenCalledWith("chat-1", { gameInventory: [{ name: "Potion", quantity: 3 }] });
    expect(patchVisibleGameStateMock).toHaveBeenCalledWith(
      "playerStats",
      expect.objectContaining({
        inventory: [
          expect.objectContaining({
            name: "Potion",
            quantity: 3,
          }),
        ],
      }),
    );
    expect(gameApi.addJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          item: "Potion",
          quantity: 3,
        }),
      }),
    );
  });

  it("caps extreme inventory tag counts before applying repeated item units", async () => {
    const persistMetadata = vi.fn(async () => null);
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

    await act(async () => {
      await applyInventoryUpdates?.([{ action: "add", items: ["Coin"], count: 1000000 }]);
    });

    expect(persistMetadata).toHaveBeenCalledWith("chat-1", { gameInventory: [{ name: "Coin", quantity: 99 }] });
    expect(gameApi.addJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          item: "Coin",
          quantity: 99,
        }),
      }),
    );
  });
});

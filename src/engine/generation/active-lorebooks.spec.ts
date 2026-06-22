import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageGateway } from "../capabilities/storage";

const mocks = vi.hoisted(() => ({
  loadCharacters: vi.fn(),
  loadChatMessages: vi.fn(),
  loadPersona: vi.fn(),
  resolveVisibleGameStateAnchor: vi.fn(),
  scanActiveLorebooks: vi.fn(),
  selectTrackerSnapshotForGeneration: vi.fn(),
}));

vi.mock("./active-lorebook-scanner", () => ({
  lorebookActivatedEntryForEvent: (entry: unknown) => entry,
  scanActiveLorebooks: mocks.scanActiveLorebooks,
}));

vi.mock("./context", () => ({
  loadChatMessages: mocks.loadChatMessages,
  requireRecord: (value: unknown, label: string) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    throw new Error(`${label} not found`);
  },
}));

vi.mock("./prompt-assembly", () => ({
  loadCharacters: mocks.loadCharacters,
  loadPersona: mocks.loadPersona,
}));

vi.mock("./generate-route-utils", () => ({
  resolveVisibleGameStateAnchor: mocks.resolveVisibleGameStateAnchor,
}));

vi.mock("./tracker-snapshots", () => ({
  selectTrackerSnapshotForGeneration: mocks.selectTrackerSnapshotForGeneration,
}));

import { scanActiveLorebookEntries } from "./active-lorebooks";

function storageWithChat(chat: Record<string, unknown>): StorageGateway {
  return {
    get: vi.fn(async (entity: string, id: string) => (entity === "chats" && id === "chat-1" ? chat : null)),
  } as unknown as StorageGateway;
}

function resetScannerResult() {
  mocks.scanActiveLorebooks.mockResolvedValue({
    processedLore: { includedEntries: [] },
    budgetSkippedLorebookEntries: [],
    semanticStatus: { status: "disabled" },
  });
}

describe("scanActiveLorebookEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScannerResult();
    mocks.loadCharacters.mockResolvedValue([]);
    mocks.loadPersona.mockResolvedValue(null);
    mocks.loadChatMessages.mockResolvedValue([
      { id: "user-1", role: "user", content: "look around" },
      { id: "assistant-1", role: "assistant", content: "A changed room." },
    ]);
  });

  it("uses the visible game-state snapshot for legacy chatMode-only game chats", async () => {
    const rawGameState = { location: "old room" };
    const snapshot = { location: "changed room" };
    const visibleAnchor = { messageId: "assistant-1", swipeIndex: 0 };
    mocks.resolveVisibleGameStateAnchor.mockReturnValue(visibleAnchor);
    mocks.selectTrackerSnapshotForGeneration.mockResolvedValue(snapshot);

    await scanActiveLorebookEntries(
      storageWithChat({ id: "chat-1", chatMode: "game", gameState: rawGameState, metadata: {} }),
      "chat-1",
    );

    expect(mocks.selectTrackerSnapshotForGeneration).toHaveBeenCalledWith(expect.anything(), "chat-1", {
      preferLatestVisible: true,
      visibleAnchor,
    });
    expect(mocks.scanActiveLorebooks).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ gameState: snapshot }),
        generationTriggers: ["game", "chat"],
      }),
    );
  });

  it("does not look up a tracker snapshot for non-game chatMode values", async () => {
    await scanActiveLorebookEntries(
      storageWithChat({ id: "chat-1", chatMode: "roleplay", gameState: { location: "raw" }, metadata: {} }),
      "chat-1",
    );

    expect(mocks.resolveVisibleGameStateAnchor).not.toHaveBeenCalled();
    expect(mocks.selectTrackerSnapshotForGeneration).not.toHaveBeenCalled();
    expect(mocks.scanActiveLorebooks).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ gameState: { location: "raw" } }),
        generationTriggers: ["roleplay", "chat"],
      }),
    );
  });

  it("keeps the raw game state fallback when a game chat has no visible anchor", async () => {
    const rawGameState = { location: "fallback room" };
    mocks.resolveVisibleGameStateAnchor.mockReturnValue(null);

    await scanActiveLorebookEntries(
      storageWithChat({ id: "chat-1", chatMode: "game", gameState: rawGameState, metadata: {} }),
      "chat-1",
    );

    expect(mocks.selectTrackerSnapshotForGeneration).not.toHaveBeenCalled();
    expect(mocks.scanActiveLorebooks).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ gameState: rawGameState }),
        generationTriggers: ["game", "chat"],
      }),
    );
  });
});

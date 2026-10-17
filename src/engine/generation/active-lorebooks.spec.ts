import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageGateway } from "../capabilities/storage";

const mocks = vi.hoisted(() => ({
  loadCharacters: vi.fn(),
  loadChatMessages: vi.fn(),
  loadPersona: vi.fn(),
  resolveVisibleTrackerStateAnchor: vi.fn(),
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
  resolveVisibleTrackerStateAnchor: mocks.resolveVisibleTrackerStateAnchor,
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

  it("does not look up a tracker snapshot for non-game chatMode values", async () => {
    await scanActiveLorebookEntries(
      storageWithChat({ id: "chat-1", chatMode: "roleplay", gameState: { location: "raw" }, metadata: {} }),
      "chat-1",
    );

    expect(mocks.resolveVisibleTrackerStateAnchor).not.toHaveBeenCalled();
    expect(mocks.selectTrackerSnapshotForGeneration).not.toHaveBeenCalled();
    expect(mocks.scanActiveLorebooks).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ gameState: { location: "raw" } }),
        generationTriggers: ["roleplay", "chat"],
      }),
    );
  });

  it("keeps the raw game state fallback when a game chat has no visible anchor", async () => {
    const rawTrackerState = { location: "fallback room" };
    mocks.resolveVisibleTrackerStateAnchor.mockReturnValue(null);

    await scanActiveLorebookEntries(
      storageWithChat({ id: "chat-1", chatMode: "game", gameState: rawTrackerState, metadata: {} }),
      "chat-1",
    );

    expect(mocks.selectTrackerSnapshotForGeneration).not.toHaveBeenCalled();
    expect(mocks.scanActiveLorebooks).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ gameState: rawTrackerState }),
        generationTriggers: ["game", "chat"],
      }),
    );
  });
});

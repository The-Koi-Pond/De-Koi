import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  check: vi.fn(),
  busyDelay: vi.fn(),
  markUnread: vi.fn(),
}));

vi.mock("../shared/api/storage-api", () => ({ storageApi: { list: mocks.list, get: mocks.get } }));
vi.mock("../shared/api/chat-command-api", () => ({ chatCommandApi: { markAutonomousUnread: mocks.markUnread } }));
vi.mock("../engine/modes/chat/autonomous/autonomous.service", () => ({
  checkConversationAutonomous: mocks.check,
  getConversationBusyDelay: mocks.busyDelay,
  markGenerationInProgress: () => 1,
  clearGenerationInProgress: () => undefined,
  recordAssistantActivity: () => undefined,
}));

import { startAutonomousScheduler } from "./autonomous";
import type { RunnerJob } from "./jobs";

const job = { id: "job-1" } as RunnerJob;

describe("runner: characters who text first", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue([
      { id: "chat-on", name: "Wren", mode: "conversation", metadata: { autonomousMessages: true } },
      { id: "chat-off", name: "Vera", mode: "conversation", metadata: { autonomousMessages: false } },
    ]);
    mocks.get.mockResolvedValue({ data: { name: "Wren Hollis" } });
    mocks.check.mockResolvedValue({ shouldTrigger: true, characterIds: ["char-wren"] });
    mocks.busyDelay.mockResolvedValue({ delayMs: 0 });
    mocks.markUnread.mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs a reply for chats that allow it, marks the chat unread and notifies", async () => {
    const startJob = vi.fn(() => job);
    const onTexted = vi.fn(async () => undefined);
    const stop = startAutonomousScheduler({
      startJob,
      runningForChat: () => null,
      waitForJob: async () => true,
      presence: () => "idle",
      onTexted,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenCalledWith(expect.anything(), { chatId: "chat-on", userStatus: "idle" });
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ chatId: "chat-on", forCharacterId: "char-wren" }));
    expect(mocks.markUnread).toHaveBeenCalledWith("chat-on", { characterId: "char-wren" });
    expect(onTexted).toHaveBeenCalledWith({ id: "chat-on", name: "Wren" }, { id: "char-wren", name: "Wren Hollis" });
  });

  it("stays quiet on do-not-disturb and while a reply is already running", async () => {
    const startJob = vi.fn(() => job);
    let presence: "dnd" | "idle" = "dnd";
    const stop = startAutonomousScheduler({
      startJob,
      runningForChat: () => (presence === "idle" ? job : null),
      waitForJob: async () => true,
      presence: () => presence,
      onTexted: async () => undefined,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.check).not.toHaveBeenCalled();
    presence = "idle";
    await vi.advanceTimersByTimeAsync(30_000);
    stop();
    expect(startJob).not.toHaveBeenCalled();
  });
});

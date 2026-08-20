import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useAutonomousMessaging } from "./use-autonomous-messaging";

const mocks = vi.hoisted(() => ({
  checkConversationAutonomous: vi.fn(),
  generate: vi.fn(),
}));

const queryClient = {
  invalidateQueries: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));

vi.mock("../../../../../engine/modes/chat/autonomous/autonomous.service", () => ({
  checkConversationAutonomous: mocks.checkConversationAutonomous,
  checkConversationCharacterExchange: vi.fn().mockResolvedValue({ shouldTrigger: false, characterIds: [] }),
  clearGenerationInProgress: vi.fn(),
  getConversationBusyDelay: vi.fn().mockResolvedValue({ delayMs: 0 }),
  markGenerationInProgress: vi.fn().mockReturnValue(123),
  recordAssistantActivity: vi.fn(),
  recordAutonomousClientPresence: vi.fn(),
  recordUserActivity: vi.fn(),
}));

vi.mock("../../../../../engine/modes/chat/schedules/schedule.service", () => ({
  generateConversationSchedules: vi.fn(),
}));

vi.mock("../../../../../engine/modes/chat/status/status-message.service", () => ({
  maybeRefreshConversationStatusMessages: vi.fn().mockResolvedValue({ refreshed: [] }),
}));

vi.mock("../../../../catalog/characters/index", () => ({
  invalidateCharacterCollectionQueries: vi.fn(),
}));

vi.mock("../../../../catalog/chats/index", () => ({
  chatKeys: {
    detail: (id: string) => ["chats", "detail", id],
    list: () => ["chats", "list"],
    messages: (id: string) => ["chats", "messages", id],
  },
}));

vi.mock("../../../../runtime/generation/index", () => ({
  useGenerate: () => ({ generate: mocks.generate }),
}));

function Harness({ chatId }: { chatId: string }) {
  useAutonomousMessaging(chatId, true, false, false);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useAutonomousMessaging", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.invalidateQueries.mockReset();
    mocks.checkConversationAutonomous.mockReset().mockResolvedValue({ shouldTrigger: false, characterIds: [] });
    mocks.generate.mockReset().mockResolvedValue(false);
    useUIStore.setState({ userStatus: "active" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("does not let a retired chat poll replace the newly active chat timer", async () => {
    const oldChatCheck = deferred<{ shouldTrigger: boolean; characterIds: string[] }>();
    mocks.checkConversationAutonomous.mockReturnValueOnce(oldChatCheck.promise);
    act(() => root.render(<Harness chatId="chat-old" />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.checkConversationAutonomous).toHaveBeenCalledTimes(1);

    act(() => root.render(<Harness chatId="chat-new" />));
    oldChatCheck.resolve({ shouldTrigger: false, characterIds: [] });
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));

    expect(mocks.checkConversationAutonomous).toHaveBeenNthCalledWith(2, expect.anything(), {
      chatId: "chat-new",
      userStatus: "active",
    });
  });
});

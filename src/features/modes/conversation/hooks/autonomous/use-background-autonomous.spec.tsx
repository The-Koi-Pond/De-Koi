import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useBackgroundAutonomousPolling } from "./use-background-autonomous";

const mocks = vi.hoisted(() => ({
  summaries: [] as Array<{
    id: string;
    mode: string;
    metadata: { autonomousMessages?: boolean };
  }>,
  checkConversationAutonomous: vi.fn(),
  storageList: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    resetQueries: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("../../../../../engine/modes/chat/autonomous/autonomous.service", () => ({
  checkConversationAutonomous: mocks.checkConversationAutonomous,
  clearGenerationInProgress: vi.fn(),
  getConversationBusyDelay: vi.fn(),
  markGenerationInProgress: vi.fn(),
  recordAssistantActivity: vi.fn(),
}));

vi.mock("../../../../../shared/api/storage-api", () => ({
  storageApi: { list: mocks.storageList, get: vi.fn() },
}));

vi.mock("../../../../catalog/chats/index", () => ({
  chatKeys: {
    list: () => ["chats", "list"],
    messages: (id: string) => ["chats", "messages", id],
  },
  useChatSummaries: () => ({ data: mocks.summaries }),
}));

function Harness({ revision: _revision }: { revision: number }) {
  useBackgroundAutonomousPolling();
  return null;
}

describe("useBackgroundAutonomousPolling", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.summaries = [];
    mocks.storageList.mockReset();
    mocks.checkConversationAutonomous.mockReset().mockResolvedValue({
      shouldTrigger: false,
      characterIds: [],
    });
    useChatStore.setState({ activeChatId: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("does not arm a timer or list full chats when no inactive summary is eligible", () => {
    act(() => root.render(<Harness revision={0} />));

    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.storageList).not.toHaveBeenCalled();
  });

  it("keeps the initial and repeat cadence for one eligible inactive conversation", async () => {
    mocks.summaries = [{ id: "chat-1", mode: "conversation", metadata: { autonomousMessages: true } }];
    act(() => root.render(<Harness revision={0} />));

    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(mocks.checkConversationAutonomous).toHaveBeenCalledWith(expect.anything(), {
      chatId: "chat-1",
      userStatus: expect.any(String),
    });
    expect(mocks.storageList).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.checkConversationAutonomous).toHaveBeenCalledTimes(2);
  });

  it("disarms when the final eligible chat is removed and excludes the active chat", () => {
    mocks.summaries = [{ id: "chat-1", mode: "conversation", metadata: { autonomousMessages: true } }];
    act(() => root.render(<Harness revision={0} />));
    expect(vi.getTimerCount()).toBe(1);

    mocks.summaries = [{ id: "chat-1", mode: "conversation", metadata: { autonomousMessages: false } }];
    act(() => root.render(<Harness revision={1} />));
    expect(vi.getTimerCount()).toBe(0);

    mocks.summaries = [{ id: "chat-1", mode: "conversation", metadata: { autonomousMessages: true } }];
    useChatStore.setState({ activeChatId: "chat-1" });
    act(() => root.render(<Harness revision={2} />));
    expect(vi.getTimerCount()).toBe(0);
  });
});

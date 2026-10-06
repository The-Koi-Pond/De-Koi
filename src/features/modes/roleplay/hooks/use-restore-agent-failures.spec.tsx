import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listRunsForChat: vi.fn() }));

vi.mock("../../../../shared/api/agent-api", () => ({
  agentApi: { listRunsForChat: mocks.listRunsForChat },
}));

import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useRestoreAgentFailures } from "./use-restore-agent-failures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const failedRun = {
  id: "run-1",
  chatId: "chat-1",
  agentType: "world-state",
  agentName: "World State",
  messageId: "m1",
  success: false,
  error: "Provider returned HTTP 403 Forbidden",
  createdAt: "2026-10-05T21:37:00.000Z",
};

function Probe({ chatId, enabled }: { chatId: string; enabled: boolean }) {
  useRestoreAgentFailures(chatId, enabled);
  return null;
}

describe("useRestoreAgentFailures", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function render(enabled = true) {
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe chatId="chat-1" enabled={enabled} />);
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    useAgentStore.getState().reset();
    useChatStore.setState({ activeChatId: "chat-1" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    vi.clearAllMocks();
  });

  it("restores the latest turn's failures after a reload", async () => {
    mocks.listRunsForChat.mockResolvedValueOnce([failedRun]);

    await render();

    expect(mocks.listRunsForChat).toHaveBeenCalledWith("chat-1");
    expect(useAgentStore.getState().failedAgentTypes).toEqual(["world-state"]);
    expect(useAgentStore.getState().failedAgentFailures[0]?.reasonLabel).toBe("Authentication");
  });

  it("replaces leftover failures from before the HUD mounted", async () => {
    const leftover = { agentType: "continuity", agentName: "Continuity", error: "old chat", reasonLabel: null };
    useAgentStore.getState().setFailedAgentFailures([leftover]);
    mocks.listRunsForChat.mockResolvedValueOnce([failedRun]);

    await render();

    expect(useAgentStore.getState().failedAgentTypes).toEqual(["world-state"]);
  });

  it("clears leftover failures when the chat's latest turn has none", async () => {
    const leftover = { agentType: "continuity", agentName: "Continuity", error: "old chat", reasonLabel: null };
    useAgentStore.getState().setFailedAgentFailures([leftover]);
    mocks.listRunsForChat.mockResolvedValueOnce([{ ...failedRun, success: true, error: null }]);

    await render();

    expect(useAgentStore.getState().failedAgentFailures).toEqual([]);
  });

  it("keeps a failure written while the runs were loading", async () => {
    let resolve!: (runs: unknown[]) => void;
    mocks.listRunsForChat.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await render();
    const live = { agentType: "continuity", agentName: "Continuity", error: "live", reasonLabel: null };

    act(() => useAgentStore.getState().addFailedAgentFailure(live));
    await act(async () => resolve([failedRun]));

    expect(useAgentStore.getState().failedAgentFailures).toEqual([live]);
  });

  it("does not restore while a generation is running", async () => {
    useAgentStore.getState().setProcessing(true);
    mocks.listRunsForChat.mockResolvedValueOnce([failedRun]);

    await render();

    expect(useAgentStore.getState().failedAgentFailures).toEqual([]);
  });

  it("restores legacy snake_case rows with numeric success flags", async () => {
    mocks.listRunsForChat.mockResolvedValueOnce([
      {
        id: "run-legacy",
        chat_id: "chat-1",
        agent_type: "world-state",
        message_id: "m1",
        success: 0,
        error: "timeout",
        created_at: "2026-10-05T21:37:00.000Z",
      },
    ]);

    await render();

    expect(useAgentStore.getState().failedAgentTypes).toEqual(["world-state"]);
  });

  it("drops a restore that lands after the store was reset", async () => {
    let resolve!: (runs: unknown[]) => void;
    mocks.listRunsForChat.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await render();

    act(() => useAgentStore.getState().reset());
    await act(async () => resolve([failedRun]));

    expect(useAgentStore.getState().failedAgentFailures).toEqual([]);
  });

  it("ignores runs for a chat that is no longer active", async () => {
    useChatStore.setState({ activeChatId: "chat-2" });
    mocks.listRunsForChat.mockResolvedValueOnce([failedRun]);

    await render();

    expect(useAgentStore.getState().failedAgentFailures).toEqual([]);
  });

  it("does nothing when agents are off for the chat", async () => {
    await render(false);

    expect(mocks.listRunsForChat).not.toHaveBeenCalled();
    expect(useAgentStore.getState().failedAgentFailures).toEqual([]);
  });
});

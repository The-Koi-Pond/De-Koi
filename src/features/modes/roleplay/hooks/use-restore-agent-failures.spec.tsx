import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listRunsForChat: vi.fn() }));

vi.mock("../../../../shared/api/agent-api", () => ({
  agentApi: { listRunsForChat: mocks.listRunsForChat },
}));

import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useRestoreAgentFailures } from "./use-restore-agent-failures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const failedRun = {
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

  it("keeps live failures instead of overwriting them", async () => {
    const live = { agentType: "continuity", agentName: "Continuity", error: "live", reasonLabel: null };
    useAgentStore.getState().setFailedAgentFailures([live]);
    mocks.listRunsForChat.mockResolvedValueOnce([failedRun]);

    await render();

    expect(useAgentStore.getState().failedAgentFailures).toEqual([live]);
  });

  it("does not restore while a generation is running", async () => {
    useAgentStore.getState().setProcessing(true);
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

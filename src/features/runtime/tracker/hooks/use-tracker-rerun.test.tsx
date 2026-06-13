import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrackerRerun } from "./use-tracker-rerun";

const retryAgentsMock = vi.hoisted(() => vi.fn());

vi.mock("../../generation/index", () => ({
  useGenerate: () => ({
    retryAgents: retryAgentsMock,
  }),
}));

vi.mock("../../world-state/index", () => ({
  TRACKER_AGENT_TYPE_IDS: new Set(["world-state"]),
}));

vi.mock("../../../../shared/stores/agent.store", () => ({
  useAgentStore: (selector: (state: { isProcessing: boolean }) => unknown) => selector({ isProcessing: false }),
}));

vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: (selector: (state: { isStreaming: boolean; streamingChatId: string | null }) => unknown) =>
    selector({ isStreaming: false, streamingChatId: null }),
}));

let root: Root | null = null;

function renderRerunHook(flushPatch: () => Promise<void>) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let rerunTracker: ((agentType: string) => Promise<void>) | null = null;

  function Probe() {
    ({ rerunTracker } = useTrackerRerun({
      activeChatId: "chat-1",
      enabledAgentTypes: new Set(["world-state"]),
      flushPatch,
      gameStateRefreshing: false,
    }));
    return null;
  }

  act(() => {
    root!.render(<Probe />);
  });

  expect(rerunTracker).toBeTruthy();
  return rerunTracker!;
}

describe("useTrackerRerun", () => {
  beforeEach(() => {
    retryAgentsMock.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  it("flushes pending tracker edits before rerunning agents", async () => {
    const callOrder: string[] = [];
    const flushPatch = vi.fn(async () => {
      callOrder.push("flush");
    });
    retryAgentsMock.mockImplementation(async () => {
      callOrder.push("retry");
    });
    const rerunTracker = renderRerunHook(flushPatch);

    await act(async () => {
      await rerunTracker("world-state");
    });

    expect(flushPatch).toHaveBeenCalledTimes(1);
    expect(retryAgentsMock).toHaveBeenCalledWith("chat-1", ["world-state"]);
    expect(callOrder).toEqual(["flush", "retry"]);
  });

  it("does not rerun agents when the pending edit flush fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const flushPatch = vi.fn(async () => {
      throw new Error("flush failed");
    });
    const rerunTracker = renderRerunHook(flushPatch);

    await act(async () => {
      await rerunTracker("world-state");
    });

    expect(flushPatch).toHaveBeenCalledTimes(1);
    expect(retryAgentsMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

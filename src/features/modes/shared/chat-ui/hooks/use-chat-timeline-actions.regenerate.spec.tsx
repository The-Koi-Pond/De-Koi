import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useAgentStore } from "../../../../../shared/stores/agent.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  retryAgents: vi.fn(),
  branchMutateAsync: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("../../../../catalog/chats/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../catalog/chats/index")>()),
  useBranchChat: () => ({
    mutateAsync: mocks.branchMutateAsync,
  }),
}));

vi.mock("../../../../runtime/generation/index", () => ({
  useGenerate: () => ({
    generate: mocks.generate,
    retryAgents: mocks.retryAgents,
  }),
}));

import { useChatTimelineActions } from "./use-chat-timeline-actions";

describe("useChatTimelineActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let regenerate:
    | ((
        messageId: string,
        options?: { chatId?: string; propagateErrors?: boolean; skipTouchConfirm?: boolean },
      ) => Promise<void>)
    | null;
  let branch: ((messageId: string) => void | Promise<void>) | null;
  let retryAgent:
    | ((
        agentType: string,
        options?: { allowDuringGeneration?: boolean; requestedMusicVolume?: number },
      ) => Promise<void>)
    | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    regenerate = null;
    branch = null;
    retryAgent = null;
    mocks.generate.mockResolvedValue(true);
    mocks.branchMutateAsync.mockResolvedValue({ id: "branched-chat" });
    useChatStore.getState().reset();
    useAgentStore.getState().setProcessing(false);
    useUIStore.setState({ guideGenerations: false });

    function Harness() {
      const actions = useChatTimelineActions({
        activeChatId: "stale-active-chat",
        messages: [],
        messageIdByOrderIndex: new Map(),
      });
      regenerate = actions.handleRegenerate;
      branch = actions.handleBranch;
      retryAgent = actions.handleRetryAgent;
      return null;
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    useChatStore.getState().reset();
    useAgentStore.getState().setProcessing(false);
    vi.clearAllMocks();
  });

  it("regenerates the explicitly owning chat instead of stale ambient chat state", async () => {
    await act(async () => {
      await regenerate?.("message-1", {
        chatId: "owning-chat",
        propagateErrors: true,
        skipTouchConfirm: true,
      });
    });

    expect(mocks.generate).toHaveBeenCalledWith({
      chatId: "owning-chat",
      connectionId: null,
      regenerateMessageId: "message-1",
      forCharacterId: null,
    });
  });

  it("reports branch creation failures and leaves the active chat unchanged", async () => {
    const error = new Error("Branch storage failed");
    mocks.branchMutateAsync.mockRejectedValueOnce(error);

    await act(async () => {
      await branch?.("message-1");
    });

    expect(mocks.branchMutateAsync).toHaveBeenCalledWith({
      chatId: "stale-active-chat",
      upToMessageId: "message-1",
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Branch storage failed");
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("opens the new chat after branch creation succeeds", async () => {
    await act(async () => {
      await branch?.("message-1");
    });

    expect(useChatStore.getState().activeChatId).toBe("branched-chat");
  });

  it("runs Music Player retries as background work while the chat response is streaming", async () => {
    await act(async () => {
      useChatStore.setState({ isStreaming: true, streamingChatId: "stale-active-chat" });
      useAgentStore.getState().setProcessing(true);
    });

    await act(async () => {
      await retryAgent?.("music-dj", { allowDuringGeneration: true, requestedMusicVolume: 27 });
    });

    expect(mocks.retryAgents).toHaveBeenCalledWith("stale-active-chat", ["music-dj"], {
      requestedMusicVolume: 27,
      runInBackground: true,
    });
  });

  it("keeps non-music agent retries blocked while the chat response is streaming", async () => {
    await act(async () => {
      useChatStore.setState({ isStreaming: true, streamingChatId: "stale-active-chat" });
      useAgentStore.getState().setProcessing(true);
    });

    await act(async () => {
      await retryAgent?.("illustrator", { allowDuringGeneration: true });
    });

    expect(mocks.retryAgents).not.toHaveBeenCalled();
  });
});

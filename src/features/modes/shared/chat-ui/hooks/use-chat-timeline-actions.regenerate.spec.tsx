import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  retryAgents: vi.fn(),
}));

vi.mock("../../../../runtime/generation/index", () => ({
  useGenerate: () => ({
    generate: mocks.generate,
    retryAgents: mocks.retryAgents,
  }),
}));

import { useChatTimelineActions } from "./use-chat-timeline-actions";

describe("useChatTimelineActions regeneration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let regenerate:
    | ((messageId: string, options?: { chatId?: string; propagateErrors?: boolean; skipTouchConfirm?: boolean }) => Promise<void>)
    | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    regenerate = null;
    mocks.generate.mockResolvedValue(true);
    useChatStore.getState().reset();
    useUIStore.setState({ guideGenerations: false });

    function Harness() {
      regenerate = useChatTimelineActions({
        activeChatId: "stale-active-chat",
        messages: [],
        messageIdByOrderIndex: new Map(),
      }).handleRegenerate;
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
});

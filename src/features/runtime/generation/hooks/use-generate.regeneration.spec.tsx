import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chat, StreamEvent } from "../../../../engine/contracts/types/chat";
import { chatKeys } from "../../../catalog/chats";
import { useChatStore } from "../../../../shared/stores/chat.store";

const mocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  retryGenerationAgents: vi.fn(),
}));

vi.mock("../../../../engine/generation/start-generation", () => ({
  startGeneration: mocks.startGeneration,
  retryGenerationAgents: mocks.retryGenerationAgents,
}));

import { useGenerate, type GenerateArgs } from "./use-generate";

describe("useGenerate regeneration", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;
  let generate: ((args: GenerateArgs) => Promise<boolean>) | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    generate = null;
    mocks.startGeneration.mockImplementation(async function* () {
      yield {
        type: "assistant_message",
        data: {
          id: "assistant-2",
          chatId: "chat-1",
          role: "assistant",
          content: "Researched answer.",
        },
      } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    queryClient.clear();
    container.remove();
    useChatStore.getState().reset();
    vi.clearAllMocks();
  });

  function Harness() {
    generate = useGenerate().generate;
    return null;
  }

  it("lets the engine own regeneration replay when the browser message cache is stale", async () => {
    queryClient.setQueryData(chatKeys.detail("chat-1"), {
      id: "chat-1",
      mode: "conversation",
      metadata: {},
    } as Chat);
    queryClient.setQueryData(chatKeys.messages("chat-1"), []);

    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });

    await expect(
      act(async () => {
        await generate?.({
          chatId: "chat-1",
          regenerateMessageId: "assistant-1",
        });
      }),
    ).resolves.toBeUndefined();
    expect(mocks.startGeneration).toHaveBeenCalledOnce();
  });
});

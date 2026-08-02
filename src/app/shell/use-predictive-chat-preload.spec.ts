import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { chatKeys } from "../../features/catalog/chats/sidebar";
import { createPredictiveChatPreloadDependencies } from "./use-predictive-chat-preload";

describe("predictive chat preload query adapter", () => {
  it("disables retries and removes only exact predictor-owned keys", async () => {
    const queryClient = {
      getQueryData: vi.fn(() => undefined),
      prefetchQuery: vi.fn(async () => undefined),
      prefetchInfiniteQuery: vi.fn(async () => undefined),
      removeQueries: vi.fn(),
    } as unknown as QueryClient;
    const dependencies = createPredictiveChatPreloadDependencies(queryClient);

    await dependencies.prefetchDetail("chat-1");
    await dependencies.prefetchMessages("chat-1");
    dependencies.removeDetail("chat-1");
    dependencies.removeMessages("chat-1");

    expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: chatKeys.detail("chat-1"), retry: false }),
    );
    expect(queryClient.prefetchInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: chatKeys.messages("chat-1"), retry: false }),
    );
    expect(queryClient.removeQueries).toHaveBeenNthCalledWith(1, {
      queryKey: chatKeys.detail("chat-1"),
      exact: true,
    });
    expect(queryClient.removeQueries).toHaveBeenNthCalledWith(2, {
      queryKey: chatKeys.messages("chat-1"),
      exact: true,
    });
  });
});

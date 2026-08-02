import { describe, expect, it, vi } from "vitest";

import type { ChatListItem } from "../../features/catalog/chats/sidebar";
import {
  createPredictiveChatPreloadController,
  predictiveChatIntentHandlers,
  scheduleIdlePredictiveChatPreloads,
  selectRecentPredictiveChats,
  type PredictiveChatPreloadDependencies,
} from "./predictive-chat-preload";

function chat(id: string, updatedAt: string): ChatListItem {
  return {
    id,
    name: id,
    mode: "conversation",
    characterIds: [],
    groupId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: null,
    folderId: null,
    sortOrder: 0,
    connectedChatId: null,
    createdAt: updatedAt,
    updatedAt,
    metadata: {},
  };
}

function dependencies(): PredictiveChatPreloadDependencies {
  return {
    hasDetail: vi.fn(() => false),
    hasMessages: vi.fn(() => false),
    preloadSurface: vi.fn(async () => undefined),
    preloadRoute: vi.fn(async () => undefined),
    prefetchDetail: vi.fn(async () => undefined),
    prefetchMessages: vi.fn(async () => undefined),
    removeDetail: vi.fn(),
    removeMessages: vi.fn(),
  };
}

describe("predictive chat preload", () => {
  it("selects the three newest non-active chats", () => {
    const selected = selectRecentPredictiveChats(
      [
        chat("old", "2026-08-01T01:00:00Z"),
        chat("active", "2026-08-01T04:00:00Z"),
        chat("new", "2026-08-01T03:00:00Z"),
        chat("middle", "2026-08-01T02:00:00Z"),
        chat("oldest", "2026-08-01T00:00:00Z"),
      ],
      "active",
    );

    expect(selected.map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("evicts only predictor-owned data after a fourth non-active chat", async () => {
    const deps = dependencies();
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));

    expect(deps.removeDetail).toHaveBeenCalledWith("one");
    expect(deps.removeMessages).toHaveBeenCalledWith("one");
  });

  it("transfers an activated chat out of speculative ownership without evicting it", async () => {
    const deps = dependencies();
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    controller.setActiveChatId("one");
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));

    expect(deps.removeDetail).not.toHaveBeenCalledWith("one");
    expect(deps.removeMessages).not.toHaveBeenCalledWith("one");
  });

  it("does not remove detail data that existed before prediction", async () => {
    const deps = dependencies();
    vi.mocked(deps.hasDetail).mockImplementation((chatId) => chatId === "one");
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));

    expect(deps.removeDetail).not.toHaveBeenCalledWith("one");
    expect(deps.removeMessages).toHaveBeenCalledWith("one");
  });

  it("deduplicates in-flight intent and resolves speculative failures", async () => {
    const deps = dependencies();
    vi.mocked(deps.prefetchDetail).mockRejectedValue(new Error("offline"));
    vi.mocked(deps.preloadRoute).mockRejectedValue(new Error("chunk unavailable"));
    const controller = createPredictiveChatPreloadController(deps, 3);
    const target = chat("one", "2026-08-01T01:00:00Z");
    const first = controller.preload(target);
    const second = controller.preload(target);

    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(deps.prefetchDetail).toHaveBeenCalledOnce();
    expect(deps.preloadRoute).toHaveBeenCalledOnce();
  });

  it("runs idle candidates sequentially", async () => {
    const callbacks: Array<() => void> = [];
    let releaseFirst!: () => void;
    const preload = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    scheduleIdlePredictiveChatPreloads(
      [chat("one", "2026-08-01T01:00:00Z"), chat("two", "2026-08-01T02:00:00Z")],
      preload,
      (callback) => {
        callbacks.push(callback);
        return () => undefined;
      },
    );
    callbacks.shift()?.();

    expect(preload).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(0);
    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
  });

  it("maps pointer, focus, and touch-compatible pointer-down intent to one preload callback", () => {
    const preload = vi.fn();
    const target = chat("one", "2026-08-01T01:00:00Z");
    const handlers = predictiveChatIntentHandlers(target, preload);

    handlers.onPointerEnter();
    handlers.onFocus();
    handlers.onPointerDown();

    expect(preload).toHaveBeenCalledTimes(3);
    expect(preload).toHaveBeenNthCalledWith(1, target);
  });
});

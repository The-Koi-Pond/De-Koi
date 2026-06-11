import { useEffect, useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryTag } from "../lib/game-tag-parser";
import { useGameSceneController } from "./use-game-scene-controller";

type SegmentEnter = (segmentIndex: number) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function SceneControllerProbe({
  applyInventoryUpdates,
  inventoryUpdate,
  onReady,
}: {
  applyInventoryUpdates: (updates: InventoryTag[]) => Promise<boolean>;
  inventoryUpdate: InventoryTag;
  onReady: (handleSegmentEnter: SegmentEnter) => void;
}) {
  const appliedInventorySegmentsRef = useRef<Set<number>>(new Set());
  const controller = useGameSceneController({
    sceneRuntimeScopeKey: "chat-1:game-1",
    isMessagesLoading: false,
    isStreaming: false,
    latestAssistantMsg: null,
    latestAssistantDirectAddressMode: null,
    hasAsyncScenePrep: false,
    pendingInventorySegmentUpdates: [{ segment: 2, update: inventoryUpdate }],
    appliedInventorySegmentsRef,
    scopedAssetMap: null,
    useSpotifyGameMusic: false,
    applyInventoryUpdates,
    playDirections: vi.fn(),
  });

  useEffect(() => {
    onReady(controller.handleSegmentEnter);
  }, [controller.handleSegmentEnter, onReady]);

  return null;
}

describe("useGameSceneController inventory segment application", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("suppresses duplicate same-segment inventory applies while persistence is pending", async () => {
    const inventoryUpdate: InventoryTag = { action: "add", items: ["Iron Key"] };
    const pendingApply = deferred<boolean>();
    const applyInventoryUpdates = vi.fn(() => pendingApply.promise);
    let handleSegmentEnter: SegmentEnter | null = null;

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <SceneControllerProbe
          applyInventoryUpdates={applyInventoryUpdates}
          inventoryUpdate={inventoryUpdate}
          onReady={(handle) => {
            handleSegmentEnter = handle;
          }}
        />,
      );
    });

    act(() => {
      handleSegmentEnter?.(2);
      handleSegmentEnter?.(2);
    });

    expect(applyInventoryUpdates).toHaveBeenCalledTimes(1);
    expect(applyInventoryUpdates).toHaveBeenCalledWith([inventoryUpdate]);

    await act(async () => {
      pendingApply.resolve(true);
      await pendingApply.promise;
    });
  });

  it("rolls back the segment claim when inventory application fails so a later enter retries", async () => {
    const inventoryUpdate: InventoryTag = { action: "remove", items: ["Iron Key"] };
    const applyInventoryUpdates = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    let handleSegmentEnter: SegmentEnter | null = null;

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <SceneControllerProbe
          applyInventoryUpdates={applyInventoryUpdates}
          inventoryUpdate={inventoryUpdate}
          onReady={(handle) => {
            handleSegmentEnter = handle;
          }}
        />,
      );
    });

    await act(async () => {
      handleSegmentEnter?.(2);
      await Promise.resolve();
    });
    await act(async () => {
      handleSegmentEnter?.(2);
      await Promise.resolve();
    });

    expect(applyInventoryUpdates).toHaveBeenCalledTimes(2);
  });
});

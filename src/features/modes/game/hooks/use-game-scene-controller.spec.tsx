import { useEffect, useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../../../engine/contracts/types/chat";
import type { InventoryTag } from "../lib/game-tag-parser";
import { useGameSceneController } from "./use-game-scene-controller";

type SegmentEnter = (segmentIndex: number) => void;
type SceneController = ReturnType<typeof useGameSceneController>;

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
  segment = 2,
  onReady,
  onController,
}: {
  applyInventoryUpdates: (updates: InventoryTag[]) => Promise<boolean>;
  inventoryUpdate: InventoryTag;
  segment?: number;
  onReady: (handleSegmentEnter: SegmentEnter) => void;
  onController?: (controller: SceneController) => void;
}) {
  const appliedInventorySegmentsRef = useRef<Set<number>>(new Set());
  const controller = useGameSceneController({
    sceneRuntimeScopeKey: "chat-1:game-1",
    isMessagesLoading: false,
    isStreaming: false,
    latestAssistantMsg: null,
    latestAssistantDirectAddressMode: null,
    hasAsyncScenePrep: false,
    pendingInventorySegmentUpdates: [{ segment, update: inventoryUpdate }],
    appliedInventorySegmentsRef,
    scopedAssetMap: null,
    useSpotifyGameMusic: false,
    applyInventoryUpdates,
    playDirections: vi.fn(),
  });

  useEffect(() => {
    onReady(controller.handleSegmentEnter);
    onController?.(controller);
  }, [controller, onController, onReady]);

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

  it("applies a later reply's inventory tag at a segment index an earlier reply already used", async () => {
    const coinGain: InventoryTag = { action: "add", items: ["Green Coin"], count: 5 };
    const coinToll: InventoryTag = { action: "remove", items: ["Green Coin"], count: 1 };
    const applyInventoryUpdates = vi.fn().mockResolvedValue(true);
    let handleSegmentEnter: SegmentEnter | null = null;
    let controller: SceneController | null = null;
    const render = (inventoryUpdate: InventoryTag) =>
      root!.render(
        <SceneControllerProbe
          applyInventoryUpdates={applyInventoryUpdates}
          inventoryUpdate={inventoryUpdate}
          segment={0}
          onReady={(handle) => {
            handleSegmentEnter = handle;
          }}
          onController={(next) => {
            controller = next;
          }}
        />,
      );

    await act(async () => {
      root = createRoot(container!);
      render(coinGain);
    });
    await act(async () => {
      handleSegmentEnter?.(0);
      await Promise.resolve();
    });

    // The next reply arrives: segment state resets and its first segment carries a new tag.
    await act(async () => {
      controller!.resetSegmentEffects();
      render(coinToll);
    });
    await act(async () => {
      handleSegmentEnter?.(0);
      await Promise.resolve();
    });

    expect(applyInventoryUpdates).toHaveBeenCalledTimes(2);
    expect(applyInventoryUpdates).toHaveBeenLastCalledWith([coinToll]);
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

  describe("after a reload", () => {
    const keyFound: InventoryTag = { action: "add", items: ["Iron Key"] };
    const coinsPaid: InventoryTag = { action: "remove", items: ["Green Coin"], count: 2 };
    const mapFound: InventoryTag = { action: "add", items: ["Ruin Map"] };
    const reply = { id: "gm-1", chatId: "chat-1", role: "assistant", content: "..." } as unknown as Message;

    function ReloadProbe({
      pending,
      applyInventoryUpdates,
      onInventorySegmentsApplied,
      onController,
    }: {
      pending: Array<{ segment: number; update: InventoryTag }>;
      applyInventoryUpdates: (updates: InventoryTag[]) => Promise<boolean>;
      onInventorySegmentsApplied: (messageId: string, appliedSegments: number[]) => void;
      onController: (controller: SceneController) => void;
    }) {
      const appliedInventorySegmentsRef = useRef<Set<number>>(new Set());
      const controller = useGameSceneController({
        sceneRuntimeScopeKey: "chat-1:game-1",
        isMessagesLoading: false,
        isStreaming: false,
        latestAssistantMsg: reply,
        latestAssistantDirectAddressMode: null,
        hasAsyncScenePrep: false,
        pendingInventorySegmentUpdates: pending,
        appliedInventorySegmentsRef,
        scopedAssetMap: null,
        useSpotifyGameMusic: false,
        applyInventoryUpdates,
        onInventorySegmentsApplied,
        playDirections: vi.fn(),
      });
      useEffect(() => {
        onController(controller);
      }, [controller, onController]);
      return null;
    }

    it("catches up the tags up to where narration resumed, then applies later ones as they are read", async () => {
      const applyInventoryUpdates = vi.fn().mockResolvedValue(true);
      const onInventorySegmentsApplied = vi.fn();
      let controller: SceneController | null = null;
      const pending = [
        { segment: 0, update: keyFound },
        { segment: 2, update: coinsPaid },
        { segment: 4, update: mapFound },
      ];

      await act(async () => {
        root = createRoot(container!);
        root.render(
          <ReloadProbe
            pending={pending}
            applyInventoryUpdates={applyInventoryUpdates}
            onInventorySegmentsApplied={onInventorySegmentsApplied}
            onController={(next) => {
              controller = next;
            }}
          />,
        );
      });
      await act(async () => {
        controller!.handleSegmentResume(2);
        await Promise.resolve();
      });

      expect(applyInventoryUpdates).toHaveBeenCalledTimes(1);
      expect(applyInventoryUpdates).toHaveBeenCalledWith([keyFound, coinsPaid]);
      expect(onInventorySegmentsApplied).toHaveBeenLastCalledWith("gm-1", [0, 2]);

      await act(async () => {
        controller!.handleSegmentEnter(3);
        controller!.handleSegmentEnter(4);
        await Promise.resolve();
      });

      expect(applyInventoryUpdates).toHaveBeenCalledTimes(2);
      expect(applyInventoryUpdates).toHaveBeenLastCalledWith([mapFound]);
      expect(onInventorySegmentsApplied).toHaveBeenLastCalledWith("gm-1", [0, 2, 4]);
    });

    it("applies tags restored after the narration already resumed past them", async () => {
      const applyInventoryUpdates = vi.fn().mockResolvedValue(true);
      let controller: SceneController | null = null;
      const render = (pending: Array<{ segment: number; update: InventoryTag }>) =>
        root!.render(
          <ReloadProbe
            pending={pending}
            applyInventoryUpdates={applyInventoryUpdates}
            onInventorySegmentsApplied={vi.fn()}
            onController={(next) => {
              controller = next;
            }}
          />,
        );

      await act(async () => {
        root = createRoot(container!);
        render([]);
      });
      await act(async () => {
        controller!.handleSegmentResume(3);
      });
      await act(async () => {
        render([
          { segment: 1, update: keyFound },
          { segment: 5, update: mapFound },
        ]);
        await Promise.resolve();
      });

      expect(applyInventoryUpdates).toHaveBeenCalledTimes(1);
      expect(applyInventoryUpdates).toHaveBeenCalledWith([keyFound]);
    });

    it("keeps live reading exact: entering a segment does not apply an earlier segment's tag", async () => {
      const applyInventoryUpdates = vi.fn().mockResolvedValue(true);
      let controller: SceneController | null = null;

      await act(async () => {
        root = createRoot(container!);
        root.render(
          <ReloadProbe
            pending={[
              { segment: 0, update: keyFound },
              { segment: 2, update: coinsPaid },
            ]}
            applyInventoryUpdates={applyInventoryUpdates}
            onInventorySegmentsApplied={vi.fn()}
            onController={(next) => {
              controller = next;
            }}
          />,
        );
      });
      await act(async () => {
        controller!.handleSegmentEnter(2);
        await Promise.resolve();
      });

      expect(applyInventoryUpdates).toHaveBeenCalledTimes(1);
      expect(applyInventoryUpdates).toHaveBeenCalledWith([coinsPaid]);
    });
  });
});

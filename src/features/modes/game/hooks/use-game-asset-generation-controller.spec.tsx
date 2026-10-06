import { QueryClient } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { gameApi } from "../api/game-api";
import { useGameAssetGenerationController } from "./use-game-asset-generation-controller";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../api/game-api", () => ({
  gameApi: {
    generateAssets: vi.fn(),
    npcNamesWithPortraits: vi.fn(),
    previewGeneratedAssets: vi.fn(),
  },
}));

type Controller = ReturnType<typeof useGameAssetGenerationController>;

function Probe({ onReady }: { onReady: (controller: Controller) => void }) {
  const controller = useGameAssetGenerationController({
    activeChatId: "chat-1",
    fetchManifest: vi.fn(),
    gameImageGenerationEnabled: true,
    normalizeNpcName: (name) => name.trim().toLowerCase(),
    publishSessionChat: vi.fn(),
    queryClient: new QueryClient(),
    setPendingSegmentEffects: vi.fn(),
  });
  useEffect(() => {
    onReady(controller);
  });
  return null;
}

describe("useGameAssetGenerationController retry", () => {
  let root: Root;
  let controller: Controller;

  beforeEach(async () => {
    vi.useFakeTimers();
    useUIStore.setState({ reviewImagePromptsBeforeSend: false });
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe onReady={(value) => (controller = value)} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("waits for a timed-out batch and skips portraits it saved", async () => {
    let finishFirstBatch!: () => void;
    vi.mocked(gameApi.generateAssets)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstBatch = () => resolve({ generatedNpcAvatars: [] } as never);
          }),
      )
      .mockResolvedValue({ generatedNpcAvatars: [] } as never);
    vi.mocked(gameApi.npcNamesWithPortraits).mockResolvedValue(["Bob"]);
    const payload = {
      chatId: "chat-1",
      npcsNeedingAvatars: [
        { name: "Bob", description: "merchant" },
        { name: "Ann", description: "guard" },
      ],
    } as never;

    let first!: Promise<unknown>;
    await act(async () => {
      first = controller.requestAssetGeneration(payload);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
      await first;
    });
    expect(controller.assetGenerationError).toBe("Image generation timed out.");

    await act(async () => {
      controller.retryAssetGeneration(null);
      controller.retryAssetGeneration(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gameApi.generateAssets).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirstBatch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gameApi.generateAssets).toHaveBeenCalledTimes(2);
    expect(vi.mocked(gameApi.generateAssets).mock.calls[1]?.[0]).toMatchObject({
      npcsNeedingAvatars: [{ name: "Ann", description: "guard" }],
    });
    expect(gameApi.npcNamesWithPortraits).toHaveBeenCalledWith("chat-1");
  });

  it("does not hold another chat's batch behind a timed-out one", async () => {
    vi.mocked(gameApi.generateAssets)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ generatedNpcAvatars: [] } as never);

    let first!: Promise<unknown>;
    await act(async () => {
      first = controller.requestAssetGeneration({ chatId: "chat-1", npcsNeedingAvatars: [{ name: "Bob" }] } as never);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
      await first;
    });
    await act(async () => {
      void controller.requestAssetGeneration({ chatId: "chat-2", npcsNeedingAvatars: [{ name: "Cy" }] } as never);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gameApi.generateAssets).toHaveBeenCalledTimes(2);
  });

  it("stops waiting for a batch that never settles after one more timeout window", async () => {
    vi.mocked(gameApi.generateAssets)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ generatedNpcAvatars: [] } as never);
    const payload = { chatId: "chat-1", npcsNeedingAvatars: [{ name: "Bob" }] } as never;

    let first!: Promise<unknown>;
    await act(async () => {
      first = controller.requestAssetGeneration(payload);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
      await first;
    });
    await act(async () => {
      void controller.requestAssetGeneration(payload);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(gameApi.generateAssets).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(gameApi.generateAssets).toHaveBeenCalledTimes(2);
  });
});

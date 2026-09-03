import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { SceneFullPlan } from "../../../../engine/contracts/types/scene";
import { llmApi } from "../../../../shared/api/llm-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useScene } from "./use-scene";

const mocks = vi.hoisted(() => ({
  createScene: vi.fn(),
  concludeScene: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("../../../../engine/modes/roleplay/scene/scene-service", () => ({
  createRoleplayScene: mocks.createScene,
  concludeRoleplayScene: mocks.concludeScene,
  planRoleplayScene: vi.fn(),
  reopenRoleplayScene: vi.fn(),
  abandonRoleplayScene: vi.fn(),
  forkRoleplayScene: vi.fn(),
}));

vi.mock("../../../../engine/modes/roleplay/continuity-director/continuity-director-scheduler", () => ({
  scheduleContinuityDirectorRefresh: mocks.schedule,
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  mocks.createScene.mockReset();
  mocks.concludeScene.mockReset();
  mocks.schedule.mockReset();
  useChatStore.getState().setActiveChatId(null);
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current: ReturnType<typeof useScene> | null = null;
  function Probe() {
    current = useScene();
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return () => current!;
}

describe("useScene continuity director scheduling", () => {
  it("queues origin-chat refresh only after successful scene creation and conclusion", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("origin-chat"));
    mocks.createScene.mockResolvedValue({ chatId: "scene-chat", chatName: "The Gate" });
    mocks.concludeScene.mockResolvedValue({ originChatId: "origin-chat" });
    const hook = await renderHook();

    await act(async () => {
      await hook().createScene({ plan: {} as SceneFullPlan });
    });
    expect(mocks.schedule).toHaveBeenCalledWith({
      storage: storageApi,
      llm: llmApi,
      chatId: "origin-chat",
      trigger: "scene_created",
    });

    await act(async () => {
      await hook().concludeScene("scene-chat");
    });
    expect(mocks.schedule).toHaveBeenCalledWith({
      storage: storageApi,
      llm: llmApi,
      chatId: "origin-chat",
      trigger: "scene_concluded",
    });
  });

  it("does not queue a refresh when scene creation fails", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("origin-chat"));
    mocks.createScene.mockRejectedValue(new Error("scene failed"));
    const hook = await renderHook();

    await act(async () => {
      await expect(hook().createScene({ plan: {} as SceneFullPlan })).resolves.toBeNull();
    });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

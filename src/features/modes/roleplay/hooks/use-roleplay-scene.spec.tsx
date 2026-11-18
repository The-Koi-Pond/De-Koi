import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { SceneFullPlan } from "../../../../engine/modes/roleplay/scene/scene-types";
import { llmApi } from "../../../../shared/api/llm-api";
import { roleplayWorldTickKeys } from "../../../../shared/api/roleplay-world-tick-query-keys";
import { storageApi } from "../../../../shared/api/storage-api";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { chatKeys } from "../../../catalog/chats";
import { useRoleplayScene } from "./use-roleplay-scene";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  conclude: vi.fn(),
  discard: vi.fn(),
  reopen: vi.fn(),
  fork: vi.fn(),
  schedule: vi.fn(),
  offer: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "summary-toast"),
  }),
}));

vi.mock("../../../../engine/modes/roleplay/scene/scene-create", () => ({ createRoleplayScene: mocks.create }));
vi.mock("../../../../engine/modes/roleplay/scene/scene-lifecycle", () => ({
  concludeRoleplayScene: mocks.conclude,
  discardRoleplayScene: mocks.discard,
  reopenRoleplayScene: mocks.reopen,
}));
vi.mock("../../../../engine/modes/roleplay/scene/scene-fork", () => ({ forkRoleplayScene: mocks.fork }));
vi.mock("../../../../engine/modes/roleplay/continuity-director/continuity-director-scheduler", () => ({
  scheduleContinuityDirectorRefresh: mocks.schedule,
}));
vi.mock("../../../../engine/modes/roleplay/world-tick/world-tick-offers", () => ({
  offerWorldTickAfterScene: mocks.offer,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.clearAllMocks();
  useChatStore.getState().setActiveChatId(null);
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderSceneHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current: ReturnType<typeof useRoleplayScene> | null = null;
  function Probe() {
    current = useRoleplayScene();
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
  return { hook: () => current!, client };
}

describe("useRoleplayScene", () => {
  it("queues a Continuity Director refresh for the origin only after a successful create and conclude", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("origin-chat"));
    mocks.create.mockResolvedValue({
      chatId: "scene-chat",
      chatName: "Scene: The Gate",
      description: "",
      background: null,
    });
    mocks.conclude.mockResolvedValue({ originChatId: "origin-chat", summary: "Done." });
    mocks.offer.mockResolvedValue({ offered: false, reason: "offers_off" });
    const { hook } = await renderSceneHook();

    await act(async () => {
      await hook().createScene({ plan: {} as SceneFullPlan });
    });
    expect(mocks.schedule).toHaveBeenLastCalledWith({
      storage: storageApi,
      llm: llmApi,
      chatId: "origin-chat",
      trigger: "scene_created",
    });
    expect(useChatStore.getState().activeChatId).toBe("scene-chat");
    expect(mocks.toast.success).toHaveBeenCalledWith("Scene started: Scene: The Gate", { icon: "🎬" });

    await act(async () => {
      await hook().concludeScene("scene-chat");
    });
    expect(mocks.schedule).toHaveBeenLastCalledWith({
      storage: storageApi,
      llm: llmApi,
      chatId: "origin-chat",
      trigger: "scene_concluded",
    });
  });

  it("queues nothing when creating or concluding fails, and the scene stays where it was", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("scene-chat"));
    mocks.create.mockRejectedValue(new Error("scene failed"));
    mocks.conclude.mockRejectedValue(Object.assign(new Error("Summary failed."), { code: "user_facing" }));
    const { hook } = await renderSceneHook();

    await act(async () => {
      await expect(hook().createScene({ plan: {} as SceneFullPlan, originChatId: "origin-chat" })).resolves.toBeNull();
      await expect(hook().concludeScene("scene-chat")).resolves.toBe(false);
    });

    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenLastCalledWith("Summary failed.", { id: "summary-toast", icon: null });
    expect(useChatStore.getState().activeChatId).toBe("scene-chat");
  });

  it("opens the origin after ending when the user is still in the scene", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("scene-chat"));
    mocks.conclude.mockResolvedValue({ originChatId: "origin-chat", summary: "Done." });
    mocks.offer.mockResolvedValue({ offered: false, reason: "offers_off" });
    const { hook } = await renderSceneHook();

    await act(async () => {
      await hook().concludeScene("scene-chat");
    });

    expect(mocks.toast.loading).toHaveBeenCalledWith("Generating scene summary...", { icon: "✍️" });
    expect(useChatStore.getState().activeChatId).toBe("origin-chat");
    expect(mocks.toast.success).toHaveBeenCalledWith("Scene concluded — summary added as a memory", {
      id: "summary-toast",
      icon: "📖",
    });
  });

  // Decision 5.
  it("leaves the user where they went while the scene ended, with a way to the conversation", async () => {
    await act(async () => useChatStore.getState().setActiveChatId("scene-chat"));
    let finish!: (value: unknown) => void;
    mocks.conclude.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.offer.mockResolvedValue({ offered: false, reason: "offers_off" });
    const { hook } = await renderSceneHook();

    let ending!: Promise<boolean>;
    await act(async () => {
      ending = hook().concludeScene("scene-chat");
    });
    await act(async () => useChatStore.getState().setActiveChatId("elsewhere"));
    await act(async () => {
      finish({ originChatId: "origin-chat", summary: "Done." });
      await ending;
    });

    expect(useChatStore.getState().activeChatId).toBe("elsewhere");
    const options = mocks.toast.success.mock.calls.at(-1)?.[1] as { action?: { label: string; onClick: () => void } };
    expect(options.action?.label).toBe("Go to conversation");
    act(() => options.action!.onClick());
    expect(useChatStore.getState().activeChatId).toBe("origin-chat");
  });

  it("warns when time can't be offered to pass, and refreshes the origin when it is", async () => {
    mocks.conclude.mockResolvedValue({ originChatId: "origin-chat", summary: "Done." });
    mocks.offer.mockRejectedValueOnce(new Error("")).mockResolvedValueOnce({ offered: true });
    const { hook, client } = await renderSceneHook();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      await hook().concludeScene("scene-chat");
    });
    expect(mocks.toast.warning).toHaveBeenCalledWith("Scene concluded, but couldn't offer to let time pass", {
      description: "Use Let time pass in the toolbar instead.",
    });

    await act(async () => {
      await hook().concludeScene("scene-chat");
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayWorldTickKeys.state("origin-chat") });
  });

  it("clears the origin's scene card from the cache at once when a scene is discarded", async () => {
    mocks.discard.mockResolvedValue({ originChatId: "origin-chat" });
    const { hook, client } = await renderSceneHook();
    client.setQueryData(chatKeys.detail("origin-chat"), {
      id: "origin-chat",
      metadata: { activeSceneChatId: "scene-chat", sceneBusyCharIds: ["mara"], keep: true },
    });
    client.setQueryData(chatKeys.detail("scene-chat"), { id: "scene-chat", metadata: {} });

    await act(async () => {
      await hook().discardScene("scene-chat");
    });

    expect(client.getQueryData(chatKeys.detail("origin-chat"))).toMatchObject({
      metadata: { activeSceneChatId: null, sceneBusyCharIds: null, keep: true },
    });
    expect(client.getQueryData(chatKeys.detail("scene-chat"))).toBeUndefined();
    expect(useChatStore.getState().activeChatId).toBe("origin-chat");
    expect(mocks.toast.success).toHaveBeenCalledWith("Scene discarded", { icon: "🗑️" });
  });

  it("runs one fork at a time and opens the new chat", async () => {
    let finish!: (value: unknown) => void;
    mocks.fork.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { hook } = await renderSceneHook();

    let first!: Promise<unknown>;
    await act(async () => {
      first = hook().forkScene("scene-chat", "clone", { upToMessageId: "m-2" });
    });
    expect(hook().isForking).toBe(true);
    await act(async () => {
      await expect(hook().forkScene("scene-chat", "convert")).resolves.toBeNull();
    });
    await act(async () => {
      finish({ chatId: "copy-chat", chatName: "Scene: X Clone", mode: "clone", originChatId: "origin-chat" });
      await first;
    });

    expect(mocks.fork).toHaveBeenCalledTimes(1);
    expect(mocks.fork).toHaveBeenCalledWith(storageApi, {
      sceneChatId: "scene-chat",
      mode: "clone",
      upToMessageId: "m-2",
    });
    expect(hook().isForking).toBe(false);
    expect(useChatStore.getState().activeChatId).toBe("copy-chat");
    expect(mocks.toast.success).toHaveBeenCalledWith("Scene cloned as roleplay");
  });

  it("reopens a scene and opens it", async () => {
    mocks.reopen.mockResolvedValue({ originChatId: "origin-chat" });
    const { hook } = await renderSceneHook();

    await act(async () => {
      await hook().reopenScene("scene-chat");
    });

    expect(useChatStore.getState().activeChatId).toBe("scene-chat");
    expect(mocks.toast.success).toHaveBeenCalledWith("Scene reopened");
  });
});

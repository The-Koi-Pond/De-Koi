import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { resolveRoleplayWorkflowProfile } from "../../../../engine/modes/roleplay/workflow-profiles";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { ChatPreset } from "../../../../engine/contracts/types/chat-preset";
import type { RoleplayContinuityDirectorApi } from "../../../../shared/api/roleplay-continuity-director-api";
import { roleplayContinuityDirectorKeys } from "../../../../shared/api/roleplay-continuity-director-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { chatKeys } from "../../chats/query-keys";
import {
  useApplyChatPreset,
  useApplyRoleplayWorkflowProfile,
  useCreateInitialContinuityPlan,
  useRevertRoleplayWorkflowProfile,
} from "./use-chat-presets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

async function setupHook<T>(useHook: () => T, client = createTestQueryClient()) {
  let current!: T;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    current = useHook();
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return {
    client,
    current: () => current,
    cleanup: async () => act(async () => root.unmount()),
  };
}

afterEach(() => vi.restoreAllMocks());

function chatPreset(id: string): ChatPreset {
  return {
    id,
    name: id,
    mode: "roleplay",
    isDefault: false,
    isActive: false,
    settings: { connectionId: `connection-${id}` },
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function presetTargetChat(id: string): Chat {
  return {
    id,
    mode: "roleplay",
    connectionId: null,
    promptPresetId: null,
    metadata: { activeAgentIds: [] },
  } as unknown as Chat;
}

function setupDeferredPresetApplicationStorage(options: { rejectFirst?: boolean } = {}) {
  const presets = new Map([
    ["preset-a", chatPreset("preset-a")],
    ["preset-b", chatPreset("preset-b")],
  ]);
  const chats = new Map([
    ["chat-1", presetTargetChat("chat-1")],
    ["chat-2", presetTargetChat("chat-2")],
  ]);
  const events: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstHold = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });

  vi.spyOn(storageApi, "get").mockImplementation(async (entity, id) => {
    if (entity === "chat-presets") return presets.get(id) as never;
    return chats.get(id) as never;
  });
  vi.spyOn(storageApi, "update").mockImplementation(async (_entity, chatId, patch) => {
    const presetId = (patch.metadata as Record<string, unknown>).appliedChatPresetId as string;
    events.push(`${chatId}:${presetId}:start`);
    if (presetId === "preset-a") {
      markFirstStarted();
      await firstHold;
      if (options.rejectFirst) {
        events.push(`${chatId}:${presetId}:reject`);
        throw new Error("first preset write failed");
      }
    }

    const current = chats.get(chatId);
    if (!current) throw new Error(`Chat ${chatId} was not found`);
    const updated = {
      ...current,
      ...patch,
      metadata: { ...current.metadata, ...(patch.metadata as Record<string, unknown>) },
    } as Chat;
    chats.set(chatId, updated);
    events.push(`${chatId}:${presetId}:finish`);
    return updated as never;
  });

  return { chats, events, firstStarted, releaseFirst };
}

it("refreshes only the exact newly enabled Director state and invalidates chat state", async () => {
  const refresh = vi.fn().mockResolvedValue({
    state: { ...createDefaultContinuityDirectorState(), enabled: true },
    isStale: false,
    sourceUnavailable: false,
    rejectedUnsafeBeats: 0,
  });
  const hook = await setupHook(() =>
    useCreateInitialContinuityPlan({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">),
  );
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  const exactPostApplyState = { ...createDefaultContinuityDirectorState(), enabled: true, revision: 4 };
  await act(async () => hook.current().mutateAsync({ chatId: "chat-1", expectedDirectorState: exactPostApplyState }));

  expect(refresh).toHaveBeenCalledWith("chat-1", { initialExpectedDirectorState: exactPostApplyState });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["roleplay-continuity-director", "state", "chat-1"],
  });
  await hook.cleanup();
});

it("surfaces planner failure to the caller", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("planning connection unavailable"));
  const hook = await setupHook(() =>
    useCreateInitialContinuityPlan({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">),
  );

  await act(async () => {
    await expect(
      hook.current().mutateAsync({
        chatId: "chat-1",
        expectedDirectorState: { ...createDefaultContinuityDirectorState(), enabled: true },
      }),
    ).rejects.toThrow("planning connection unavailable");
  });

  await hook.cleanup();
});

const capabilities = {
  hasUniversalPreset: true,
  localSidecarReady: true,
  hasImageConnection: true,
  imageConnection: { label: "Image provider", mayUsePaidOrExternalService: true },
  hasUsableBackgroundAssets: true,
  musicModuleEnabled: true,
  ttsReady: true,
};

it("preserves a Director edit that lands after the preset reads and before its update", async () => {
  const initialDirector = {
    ...createDefaultContinuityDirectorState(),
    enabled: true,
    revision: 3,
  };
  const winningDirector = {
    ...initialDirector,
    revision: 4,
    currentArc: {
      id: "winning-arc",
      text: "Concurrent user edit",
      source: "user" as const,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z",
    },
  };
  const events: string[] = [];
  let currentChat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: null,
    promptPresetId: null,
    metadata: { activeAgentIds: [], roleplayContinuityDirector: initialDirector },
  } as unknown as Chat;
  const preset = {
    id: "preset-1",
    name: "Preset",
    mode: "roleplay",
    isDefault: false,
    isActive: false,
    settings: { metadata: { enableMemoryRecall: true } },
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };

  vi.spyOn(storageApi, "get").mockImplementation(async (entity) => {
    if (entity === "chat-presets") {
      events.push("preset-read");
      return preset as never;
    }
    events.push("chat-read");
    const staleChat = currentChat;
    currentChat = {
      ...currentChat,
      metadata: { ...currentChat.metadata, roleplayContinuityDirector: winningDirector },
    } as Chat;
    events.push("director-write");
    return staleChat as never;
  });
  const update = vi.spyOn(storageApi, "update").mockImplementation(async (_entity, _id, patch) => {
    events.push("preset-update");
    currentChat = {
      ...currentChat,
      ...patch,
      metadata: { ...currentChat.metadata, ...(patch.metadata as Record<string, unknown>) },
    } as Chat;
    return currentChat as never;
  });
  const hook = await setupHook(() => useApplyChatPreset());

  await act(async () => hook.current().mutateAsync({ presetId: preset.id, chatId: currentChat.id }));

  expect(events).toEqual(["preset-read", "chat-read", "director-write", "preset-update"]);
  expect(update.mock.calls[0]?.[2].metadata).not.toHaveProperty("roleplayContinuityDirector");
  expect(currentChat.metadata.roleplayContinuityDirector).toEqual(winningDirector);
  await hook.cleanup();
});

it("serializes preset writes for one chat across hook unmounts so the later apply wins", async () => {
  const { chats, events, firstStarted, releaseFirst } = setupDeferredPresetApplicationStorage();
  const client = createTestQueryClient();
  const firstHook = await setupHook(() => useApplyChatPreset(), client);
  let firstApply!: Promise<Chat>;

  await act(async () => {
    firstApply = firstHook.current().mutateAsync({ presetId: "preset-a", chatId: "chat-1" });
    await firstStarted;
  });
  await firstHook.cleanup();

  const secondHook = await setupHook(() => useApplyChatPreset(), client);
  let secondApply!: Promise<Chat>;
  await act(async () => {
    secondApply = secondHook.current().mutateAsync({ presetId: "preset-b", chatId: "chat-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([firstApply, secondApply]);
  });

  expect(events).toEqual([
    "chat-1:preset-a:start",
    "chat-1:preset-a:finish",
    "chat-1:preset-b:start",
    "chat-1:preset-b:finish",
  ]);
  expect(chats.get("chat-1")?.metadata.appliedChatPresetId).toBe("preset-b");
  await secondHook.cleanup();
});

it("releases the same-chat preset queue when the first write rejects", async () => {
  const { chats, events, firstStarted, releaseFirst } = setupDeferredPresetApplicationStorage({
    rejectFirst: true,
  });
  const client = createTestQueryClient();
  const firstHook = await setupHook(() => useApplyChatPreset(), client);
  let firstApply!: Promise<Chat>;

  await act(async () => {
    firstApply = firstHook.current().mutateAsync({ presetId: "preset-a", chatId: "chat-1" });
    await firstStarted;
  });
  const firstOutcome = firstApply.then(
    () => null,
    (error: unknown) => error,
  );
  await firstHook.cleanup();

  const secondHook = await setupHook(() => useApplyChatPreset(), client);
  let secondApply!: Promise<Chat>;
  await act(async () => {
    secondApply = secondHook.current().mutateAsync({ presetId: "preset-b", chatId: "chat-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([firstOutcome, secondApply]);
  });

  expect(await firstOutcome).toEqual(new Error("first preset write failed"));
  expect(events).toEqual([
    "chat-1:preset-a:start",
    "chat-1:preset-a:reject",
    "chat-1:preset-b:start",
    "chat-1:preset-b:finish",
  ]);
  expect(chats.get("chat-1")?.metadata.appliedChatPresetId).toBe("preset-b");
  await secondHook.cleanup();
});

it("keeps preset writes for different chats parallel", async () => {
  const { events, firstStarted, releaseFirst } = setupDeferredPresetApplicationStorage();
  const client = createTestQueryClient();
  const firstHook = await setupHook(() => useApplyChatPreset(), client);
  const secondHook = await setupHook(() => useApplyChatPreset(), client);
  let firstApply!: Promise<Chat>;
  let secondApply!: Promise<Chat>;

  await act(async () => {
    firstApply = firstHook.current().mutateAsync({ presetId: "preset-a", chatId: "chat-1" });
    await firstStarted;
  });
  await act(async () => {
    secondApply = secondHook.current().mutateAsync({ presetId: "preset-b", chatId: "chat-2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const secondFinishedBeforeRelease = events.includes("chat-2:preset-b:finish");

  await act(async () => {
    releaseFirst();
    await Promise.all([firstApply, secondApply]);
  });

  expect(secondFinishedBeforeRelease).toBe(true);
  expect(events).toEqual([
    "chat-1:preset-a:start",
    "chat-2:preset-b:start",
    "chat-2:preset-b:finish",
    "chat-1:preset-a:finish",
  ]);
  await firstHook.cleanup();
  await secondHook.cleanup();
});

function workflowChat(receipt = false): Chat {
  return {
    id: "chat-1",
    mode: "roleplay",
    promptPresetId: null,
    connectionId: null,
    metadata: {
      activeAgentIds: [],
      activeToolIds: [],
      agentOverrides: {},
      presetChoices: {},
      tags: [],
      ...(receipt
        ? {
            roleplayWorkflowApplication: {
              profileId: "minimal-clean" as const,
              profileVersion: 1,
              appliedAt: "2026-09-03T12:00:00.000Z",
              selectedItemIds: [],
              changes: [],
            },
          }
        : {}),
    },
  } as unknown as Chat;
}

it("invalidates Director state immediately after a workflow apply", async () => {
  const chat = workflowChat();
  vi.spyOn(storageApi, "get").mockResolvedValue(chat as never);
  vi.spyOn(storageApi, "updateChatIfUnchanged").mockImplementation(
    async (_chatId: string, _expected: Record<string, unknown>, patch: Record<string, unknown>) => ({
      updated: true,
      chat: {
        ...chat,
        ...patch,
        metadata: { ...chat.metadata, ...(patch.metadata as Record<string, unknown>) },
      },
    }),
  );
  const preview = resolveRoleplayWorkflowProfile("minimal-clean", { chat, capabilities });
  const hook = await setupHook(() =>
    useApplyRoleplayWorkflowProfile({ resolveCapabilities: async () => capabilities }),
  );
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  await act(async () =>
    hook.current().mutateAsync({
      chatId: chat.id,
      profileId: "minimal-clean",
      preview,
      selectedItemIds: [],
    }),
  );

  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state(chat.id) });
  await hook.cleanup();
});

it("invalidates Director state after a rejected workflow apply", async () => {
  const chat = workflowChat();
  vi.spyOn(storageApi, "get").mockRejectedValueOnce(new Error("storage unavailable"));
  const preview = resolveRoleplayWorkflowProfile("minimal-clean", { chat, capabilities });
  const hook = await setupHook(() =>
    useApplyRoleplayWorkflowProfile({ resolveCapabilities: async () => capabilities }),
  );
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  await act(async () => {
    await expect(
      hook.current().mutateAsync({
        chatId: chat.id,
        profileId: "minimal-clean",
        preview,
        selectedItemIds: [],
      }),
    ).rejects.toThrow("storage unavailable");
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state(chat.id) });
  await hook.cleanup();
});

it("invalidates Director state immediately after a workflow revert", async () => {
  const chat = workflowChat(true);
  vi.spyOn(storageApi, "get").mockResolvedValue(chat as never);
  vi.spyOn(storageApi, "updateChatIfUnchanged").mockImplementation(
    async (_chatId: string, _expected: Record<string, unknown>, patch: Record<string, unknown>) => ({
      updated: true,
      chat: {
        ...chat,
        ...patch,
        metadata: { ...chat.metadata, ...(patch.metadata as Record<string, unknown>) },
      },
    }),
  );
  const hook = await setupHook(() => useRevertRoleplayWorkflowProfile());
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  await act(async () => hook.current().mutateAsync(chat.id));

  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state(chat.id) });
  await hook.cleanup();
});

it("invalidates Director state after a rejected workflow revert", async () => {
  const chat = workflowChat(true);
  vi.spyOn(storageApi, "get").mockRejectedValueOnce(new Error("storage unavailable"));
  const hook = await setupHook(() => useRevertRoleplayWorkflowProfile());
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  await act(async () => {
    await expect(hook.current().mutateAsync(chat.id)).rejects.toThrow("storage unavailable");
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: roleplayContinuityDirectorKeys.state(chat.id) });
  await hook.cleanup();
});

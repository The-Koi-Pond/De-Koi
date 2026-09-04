import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { resolveRoleplayWorkflowProfile } from "../../../../engine/modes/roleplay/workflow-profiles";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { RoleplayContinuityDirectorApi } from "../../../../shared/api/roleplay-continuity-director-api";
import { roleplayContinuityDirectorKeys } from "../../../../shared/api/roleplay-continuity-director-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { chatKeys } from "../../chats/query-keys";
import {
  useApplyRoleplayWorkflowProfile,
  useCreateInitialContinuityPlan,
  useRevertRoleplayWorkflowProfile,
} from "./use-chat-presets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setupHook<T>(useHook: () => T) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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

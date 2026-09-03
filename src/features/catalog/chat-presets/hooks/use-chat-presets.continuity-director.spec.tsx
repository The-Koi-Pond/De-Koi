import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import type { RoleplayContinuityDirectorApi } from "../../../../shared/api/roleplay-continuity-director-api";
import { chatKeys } from "../../chats/query-keys";
import { useCreateInitialContinuityPlan } from "./use-chat-presets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setup(api: Pick<RoleplayContinuityDirectorApi, "refresh">) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let current!: ReturnType<typeof useCreateInitialContinuityPlan>;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    current = useCreateInitialContinuityPlan(api);
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

it("refreshes a newly enabled Director and invalidates chat state", async () => {
  const refresh = vi.fn().mockResolvedValue({
    state: { ...createDefaultContinuityDirectorState(), enabled: true },
    isStale: false,
    sourceUnavailable: false,
    rejectedUnsafeBeats: 0,
  });
  const hook = await setup({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">);
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");

  await act(async () => hook.current().mutateAsync("chat-1"));

  expect(refresh).toHaveBeenCalledWith("chat-1");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
  await hook.cleanup();
});

it("surfaces planner failure to the caller", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("planning connection unavailable"));
  const hook = await setup({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">);

  await act(async () => {
    await expect(hook.current().mutateAsync("chat-1")).rejects.toThrow("planning connection unavailable");
  });

  await hook.cleanup();
});

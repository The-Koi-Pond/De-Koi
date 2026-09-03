import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RoleplayContinuityDirectorState } from "../../../../engine/contracts/types/roleplay-continuity-director";
import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import type { RoleplayContinuityDirectorApi } from "../../../../shared/api/roleplay-continuity-director-api";
import {
  continuityDirectorKeys,
  useContinuityDirector,
  type UseContinuityDirectorResult,
} from "./use-continuity-director";

const initial: RoleplayContinuityDirectorState = {
  ...createDefaultContinuityDirectorState("2026-09-02T12:00:00.000Z"),
  enabled: true,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function setup(api: RoleplayContinuityDirectorApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await client.ensureQueryData({
    queryKey: continuityDirectorKeys.state("chat-1"),
    queryFn: () => api.getState("chat-1"),
  });
  let latest: UseContinuityDirectorResult | null = null;
  function Probe() {
    latest = useContinuityDirector("chat-1", api);
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
  return { client, current: () => latest! };
}

describe("useContinuityDirector", () => {
  it("loads chat-scoped state and publishes command results to the cache", async () => {
    const command = vi.fn(async () => ({ state: { ...initial, enabled: false, revision: 1 }, isStale: false }));
    const api = {
      getState: vi.fn(async () => ({ state: initial, isStale: false })),
      command,
      refresh: vi.fn(),
    } as unknown as RoleplayContinuityDirectorApi;
    const hook = await setup(api);
    expect(hook.current().state?.enabled).toBe(true);

    await act(async () => {
      await hook.current().command.mutateAsync({
        command: { type: "set_enabled", enabled: false },
        expectedRevision: 0,
      });
    });

    expect(command).toHaveBeenCalledWith("chat-1", { type: "set_enabled", enabled: false }, 0);
    expect(hook.client.getQueryData(continuityDirectorKeys.state("chat-1"))).toMatchObject({
      state: { enabled: false, revision: 1 },
    });
  });

  it("keeps the last valid plan visible when refresh fails", async () => {
    const api = {
      getState: vi.fn(async () => ({ state: initial, isStale: false })),
      command: vi.fn(),
      refresh: vi.fn(async () => {
        throw new Error("Planner failed");
      }),
    } as unknown as RoleplayContinuityDirectorApi;
    const hook = await setup(api);
    expect(hook.current().state).toEqual(initial);

    await act(async () => {
      await expect(hook.current().refresh.mutateAsync()).rejects.toThrow("Planner failed");
    });

    expect(hook.current().state).toEqual(initial);
  });
});

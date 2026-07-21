import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentApi } from "../../../../shared/api/agent-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { useSetAgentEnabledByType } from "./use-agents";
import { useSetCustomToolEnabled } from "./use-custom-tools";

const enabledMutationMock = vi.hoisted(() => vi.fn((options) => options));

vi.mock("../../lib/use-enabled-toggle-mutation", () => ({
  useEnabledToggleMutation: enabledMutationMock,
}));

vi.mock("../../../../shared/api/agent-api", () => ({
  agentApi: { patchByType: vi.fn() },
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { update: vi.fn() },
}));

type EnabledOptions = {
  mutationKey: readonly unknown[];
  queryKey: readonly unknown[];
  update: (id: string, enabled: boolean) => Promise<unknown>;
  errorMessage: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("catalog enabled-toggle hook wiring", () => {
  it("keeps the agent type mutation pending until its API request resolves", async () => {
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(agentApi.patchByType).mockReturnValueOnce(gate.promise);
    const options = useSetAgentEnabledByType() as unknown as EnabledOptions;

    const save = options.update("writer-agent", false);
    let settled = false;
    void save.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(agentApi.patchByType).toHaveBeenCalledWith("writer-agent", { enabled: false });
    expect(options.mutationKey).toEqual(["agents", "enabled"]);
    expect(options.queryKey).toEqual(["agents"]);

    gate.resolve({});
    await save;
  });

  it("keeps the custom-tool row mutation pending until its validated update resolves", async () => {
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(storageApi.update).mockReturnValueOnce(gate.promise);
    const options = useSetCustomToolEnabled() as unknown as EnabledOptions;

    const save = options.update("tool-1", true);
    let settled = false;
    void save.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(storageApi.update).toHaveBeenCalledWith("custom-tools", "tool-1", { enabled: true });
    expect(options.mutationKey).toEqual(["custom-tools", "enabled"]);
    expect(options.queryKey).toEqual(["custom-tools"]);

    gate.resolve({});
    await save;
  });
});

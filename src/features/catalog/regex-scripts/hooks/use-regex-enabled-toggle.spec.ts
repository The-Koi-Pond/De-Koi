import { beforeEach, describe, expect, it, vi } from "vitest";

import { storageApi } from "../../../../shared/api/storage-api";
import { useSetRegexScriptEnabled } from "./use-regex-scripts";

const enabledMutationMock = vi.hoisted(() => vi.fn((options) => options));

vi.mock("../../lib/use-enabled-toggle-mutation", () => ({
  useEnabledToggleMutation: enabledMutationMock,
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

describe("useSetRegexScriptEnabled", () => {
  it("keeps the row mutation pending until its validated update resolves", async () => {
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(storageApi.update).mockReturnValueOnce(gate.promise);
    const options = useSetRegexScriptEnabled() as unknown as EnabledOptions;

    const save = options.update("regex-1", false);
    let settled = false;
    void save.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(storageApi.update).toHaveBeenCalledWith("regex-scripts", "regex-1", { enabled: false });
    expect(options.mutationKey).toEqual(["regex-scripts", "enabled"]);
    expect(options.queryKey).toEqual(["regex-scripts"]);

    gate.resolve({});
    await save;
  });
});

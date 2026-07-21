import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { storageApi } from "../../../../shared/api/storage-api";
import { useUpdateConnectionFolder } from "./use-connection-folders";

const reactQueryMocks = vi.hoisted(() => ({
  currentQueryClient: null as QueryClient | null,
  useMutation: vi.fn((options) => options),
}));

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: reactQueryMocks.useMutation,
    useQueryClient: () => {
      if (!reactQueryMocks.currentQueryClient) throw new Error("Missing QueryClient for test.");
      return reactQueryMocks.currentQueryClient;
    },
  };
});

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { update: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

type FolderUpdate = { id: string; collapsed: boolean };
type MutationOptions = {
  mutationFn: (variables: FolderUpdate) => Promise<unknown>;
  onMutate: (variables: FolderUpdate) => unknown | Promise<unknown>;
  onError: (error: unknown, variables: FolderUpdate, context: unknown) => void;
  onSettled: () => unknown | Promise<unknown>;
};

function deferred<T>() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  reactQueryMocks.currentQueryClient = null;
});

describe("useUpdateConnectionFolder", () => {
  it("updates while persistence is pending, then rolls back and reports a failure", async () => {
    const queryKey = ["connection-folders", "list"] as const;
    const qc = new QueryClient();
    qc.setQueryData(queryKey, [{ id: "folder-1", name: "Stories", collapsed: false }]);
    reactQueryMocks.currentQueryClient = qc;
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(storageApi.update).mockReturnValueOnce(gate.promise);
    const options = useUpdateConnectionFolder() as unknown as MutationOptions;
    const variables = { id: "folder-1", collapsed: true };

    const context = await options.onMutate(variables);
    const save = options.mutationFn(variables);

    expect(qc.getQueryData<Array<{ collapsed: boolean }>>(queryKey)?.[0]?.collapsed).toBe(true);

    const failure = new Error("save failed");
    gate.reject(failure);
    await expect(save).rejects.toThrow("save failed");
    options.onError(failure, variables, context);
    await options.onSettled();

    expect(qc.getQueryData<Array<{ collapsed: boolean }>>(queryKey)?.[0]?.collapsed).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Couldn't update that folder. Your previous folder state was restored.");
  });
});

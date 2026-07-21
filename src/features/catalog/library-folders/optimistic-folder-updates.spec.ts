import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { storageApi } from "../../../shared/api/storage-api";
import { useUpdateLibraryFolder } from "./use-library-folders";

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

vi.mock("../../../shared/api/storage-api", () => ({
  storageApi: {
    update: vi.fn(),
  },
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

type Scenario = {
  label: string;
  queryKey: readonly unknown[];
  useOptions: () => MutationOptions;
};

const scenarios: Scenario[] = [
  {
    label: "lorebook library folders",
    queryKey: ["library-folders", "lorebooks"],
    useOptions: () => useUpdateLibraryFolder("lorebooks") as unknown as MutationOptions,
  },
  {
    label: "preset library folders",
    queryKey: ["library-folders", "presets"],
    useOptions: () => useUpdateLibraryFolder("presets") as unknown as MutationOptions,
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function seedFolders(qc: QueryClient, queryKey: readonly unknown[]) {
  qc.setQueryData(queryKey, [
    { id: "folder-1", name: "Stories", collapsed: false },
    { id: "folder-2", name: "Archive", collapsed: false },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  reactQueryMocks.currentQueryClient = null;
});

describe.each(scenarios)("$label optimistic collapse updates", ({ queryKey, useOptions }) => {
  it("updates the visible cache before the save promise resolves", async () => {
    const qc = new QueryClient();
    seedFolders(qc, queryKey);
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries");
    reactQueryMocks.currentQueryClient = qc;
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(storageApi.update).mockReturnValueOnce(gate.promise);
    const options = useOptions();
    const variables = { id: "folder-1", collapsed: true };

    const context = await options.onMutate(variables);
    const save = options.mutationFn(variables);

    expect(qc.getQueryData<Array<{ id: string; collapsed: boolean }>>(queryKey)?.[0]?.collapsed).toBe(true);
    expect(context).toBeDefined();

    gate.resolve({ id: "folder-1", name: "Stories", collapsed: true });
    await save;
    await options.onSettled();

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
  });

  it("restores only the failed folder change and reports the failure", async () => {
    const qc = new QueryClient();
    seedFolders(qc, queryKey);
    reactQueryMocks.currentQueryClient = qc;
    const gate = deferred<Record<string, unknown>>();
    vi.mocked(storageApi.update).mockReturnValueOnce(gate.promise);
    const options = useOptions();
    const variables = { id: "folder-1", collapsed: true };

    const context = await options.onMutate(variables);
    const save = options.mutationFn(variables);
    qc.setQueryData<Array<{ id: string; name: string; collapsed: boolean }>>(queryKey, (folders) =>
      folders?.map((folder) => (folder.id === "folder-1" ? { ...folder, name: "Renamed while saving" } : folder)),
    );

    const failure = new Error("save failed");
    gate.reject(failure);
    await expect(save).rejects.toThrow("save failed");
    options.onError(failure, variables, context);
    await options.onSettled();

    expect(qc.getQueryData<Array<{ id: string; name: string; collapsed: boolean }>>(queryKey)).toEqual([
      { id: "folder-1", name: "Renamed while saving", collapsed: false },
      { id: "folder-2", name: "Archive", collapsed: false },
    ]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't update that folder. Your previous folder state was restored.");
  });

  it("does not let an older failed update overwrite a newer click on the same folder", async () => {
    const qc = new QueryClient();
    seedFolders(qc, queryKey);
    reactQueryMocks.currentQueryClient = qc;
    const options = useOptions();

    const olderContext = await options.onMutate({ id: "folder-1", collapsed: true });
    await options.onMutate({ id: "folder-1", collapsed: false });
    await options.onMutate({ id: "folder-1", collapsed: true });
    options.onError(new Error("older save failed"), { id: "folder-1", collapsed: true }, olderContext);

    expect(qc.getQueryData<Array<{ id: string; collapsed: boolean }>>(queryKey)?.[0]?.collapsed).toBe(true);
  });

  it("waits for the final overlapping update before reconciling from persistence", async () => {
    const qc = new QueryClient();
    seedFolders(qc, queryKey);
    reactQueryMocks.currentQueryClient = qc;
    vi.spyOn(qc, "isMutating").mockReturnValue(2);
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries");
    const options = useOptions();

    await options.onSettled();

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

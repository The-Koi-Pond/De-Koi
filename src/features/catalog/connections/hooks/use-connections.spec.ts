import { useMutation, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectionKeys,
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useDuplicateConnection,
  useSaveConnectionDefaults,
  useUpdateConnection,
  useUploadConnectionImage,
} from "./use-connections";

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn((options) => options),
  useQuery: vi.fn((options) => options),
  useQueryClient: vi.fn(() => queryClientMock),
}));

beforeEach(() => {
  vi.clearAllMocks();
  queryClientMock.invalidateQueries.mockReset();
});

describe("connection query policy", () => {
  it("reconciles conservatively while visible and never polls in the background", () => {
    const options = useConnections() as unknown as Record<string, unknown>;

    expect(options.staleTime).toBeGreaterThanOrEqual(60_000);
    expect(options.refetchInterval).toBeGreaterThanOrEqual(60_000);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(useQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps every connection mutation wired to the list query family", () => {
    const mutations = [
      [useCreateConnection, (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess()],
      [
        useUpdateConnection,
        (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess(undefined, { id: "c1" }),
      ],
      [useDuplicateConnection, (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess()],
      [useDeleteConnection, (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess({}, "c1")],
      [
        useSaveConnectionDefaults,
        (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess(undefined, { id: "c1" }),
      ],
      [
        useUploadConnectionImage,
        (options: Record<string, (...args: unknown[]) => void>) => options.onSuccess(undefined, { id: "c1" }),
      ],
    ] as const;

    for (const [useMutationHook, invokeSuccess] of mutations) {
      queryClientMock.invalidateQueries.mockClear();
      const options = useMutationHook() as unknown as Record<string, (...args: unknown[]) => void>;
      invokeSuccess(options);
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: connectionKeys.list() });
    }

    expect(useMutation).toHaveBeenCalledTimes(mutations.length);
  });
});

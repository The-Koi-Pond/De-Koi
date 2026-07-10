import { useMutation, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateExtension, useDeleteExtension, useExtensions, useUpdateExtension } from "./use-extensions";

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

describe("extension query policy", () => {
  it("reconciles on focus and reconnect without recurring polling", () => {
    const options = useExtensions() as unknown as Record<string, unknown>;

    expect(options.staleTime).toBeGreaterThanOrEqual(60_000);
    expect(options.refetchInterval).toBeUndefined();
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchOnReconnect).toBe(true);
    expect(useQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps every extension mutation wired to the extension query family", () => {
    const mutationHooks = [useCreateExtension, useUpdateExtension, useDeleteExtension] as const;

    for (const useMutationHook of mutationHooks) {
      queryClientMock.invalidateQueries.mockClear();
      const options = useMutationHook() as unknown as { onSuccess: () => void };
      options.onSuccess();
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["extensions"] });
    }

    expect(useMutation).toHaveBeenCalledTimes(mutationHooks.length);
  });
});

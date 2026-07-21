import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { useEnabledToggleMutation } from "./use-enabled-toggle-mutation";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function testClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

type HookResult = ReturnType<typeof useEnabledToggleMutation>;
let container: HTMLDivElement;
let root: Root;
let current: HookResult;

function renderToggleHook(qc: QueryClient, options: Parameters<typeof useEnabledToggleMutation>[0]): HookResult {
  function Harness() {
    current = useEnabledToggleMutation(options);
    return null;
  }

  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  return current;
}

async function flushUpdates() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flushUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) await flushUpdates();
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useEnabledToggleMutation", () => {
  it("publishes each pending row immediately, blocks duplicates, and rolls back only the failed row", async () => {
    const qc = testClient();
    const first = deferred<void>();
    const second = deferred<void>();
    const update = vi.fn((id: string) => (id === "first" ? first.promise : second.promise));
    renderToggleHook(qc, {
      mutationKey: ["test", "enabled"],
      queryKey: ["test"],
      update,
      errorMessage: "Toggle failed.",
    });

    act(() => {
      expect(current.setEnabled({ id: "first", enabled: true })).toBe(true);
      expect(current.setEnabled({ id: "first", enabled: false })).toBe(false);
      expect(current.setEnabled({ id: "second", enabled: false })).toBe(true);
    });

    await flushUpdates();
    expect(current.pendingEnabledById).toEqual(
      new Map([
        ["first", true],
        ["second", false],
      ]),
    );
    expect(update).toHaveBeenCalledTimes(2);

    first.reject(new Error("save failed"));
    await flushUntil(() => current.pendingEnabledById.size === 1);
    expect(current.pendingEnabledById).toEqual(new Map([["second", false]]));
    expect(toast.error).toHaveBeenCalledWith("Toggle failed.");

    second.resolve();
    await flushUntil(() => current.pendingEnabledById.size === 0);
    expect(current.pendingEnabledById.size).toBe(0);
  });

  it("keeps the optimistic value pending until a successful query reconciliation finishes", async () => {
    const qc = testClient();
    const updateGate = deferred<void>();
    const reconcileGate = deferred<void>();
    vi.spyOn(qc, "invalidateQueries").mockReturnValue(reconcileGate.promise);
    renderToggleHook(qc, {
      mutationKey: ["test", "enabled"],
      queryKey: ["test"],
      update: () => updateGate.promise,
      errorMessage: "Toggle failed.",
    });

    act(() => {
      current.setEnabled({ id: "row", enabled: true });
    });
    await flushUpdates();
    expect(current.pendingEnabledById.get("row")).toBe(true);

    updateGate.resolve();
    await flushUntil(() => vi.mocked(qc.invalidateQueries).mock.calls.length > 0);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["test"] });
    expect(current.pendingEnabledById.get("row")).toBe(true);

    reconcileGate.resolve();
    await flushUntil(() => current.pendingEnabledById.size === 0);
    expect(current.pendingEnabledById.size).toBe(0);
  });

  it("allows a row to retry after another row starts a later overlapping mutation", async () => {
    const qc = testClient();
    const first = deferred<void>();
    const second = deferred<void>();
    const retry = deferred<void>();
    const update = vi
      .fn<(id: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(retry.promise);
    renderToggleHook(qc, {
      mutationKey: ["test", "enabled"],
      queryKey: ["test"],
      update,
      errorMessage: "Toggle failed.",
    });

    act(() => {
      current.setEnabled({ id: "first", enabled: true });
      current.setEnabled({ id: "second", enabled: true });
    });
    await flushUpdates();

    first.resolve();
    await flushUntil(() => !current.pendingEnabledById.has("first"));

    act(() => {
      expect(current.setEnabled({ id: "first", enabled: false })).toBe(true);
    });
    await flushUpdates();
    expect(update).toHaveBeenCalledTimes(3);
    expect(current.pendingEnabledById.get("first")).toBe(false);

    second.resolve();
    retry.resolve();
    await flushUntil(() => current.pendingEnabledById.size === 0);
  });
});

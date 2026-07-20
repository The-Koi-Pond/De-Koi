import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, ExpungeError, type ExpungeFailureReceipt } from "../../../../shared/api/admin-api";
import { useExpungeData } from "./use-admin-data-reset";

const mocks = vi.hoisted(() => ({
  resetClientDataState: vi.fn(),
  resetClientSessionState: vi.fn(),
}));

vi.mock("../../actions", () => ({
  resetClientDataState: mocks.resetClientDataState,
  resetClientSessionState: mocks.resetClientSessionState,
}));

type ExpungeMutation = ReturnType<typeof useExpungeData>;

function Harness({ onReady }: { onReady: (mutation: ExpungeMutation) => void }) {
  const mutation = useExpungeData();
  useEffect(() => {
    onReady(mutation);
  }, [mutation, onReady]);
  return null;
}

describe("useExpungeData", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let mutation: ExpungeMutation | null;

  beforeEach(async () => {
    mocks.resetClientDataState.mockReset();
    mocks.resetClientSessionState.mockReset();
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    mutation = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness onReady={(value) => (mutation = value)} />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("resets client state when a rejected partial receipt reports mutation", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats", "media"],
      completedScopes: ["chats"],
      remainingScopes: ["media"],
      failedScope: "media",
      clearedCollections: ["chats"],
      cause: { code: "io_error", message: "media cleanup failed" },
    };
    vi.spyOn(adminApi, "expunge").mockRejectedValue(new ExpungeError("Partial erasure", 500, receipt));

    await act(async () => {
      await mutation!.mutateAsync(["chats", "media"]).catch(() => undefined);
    });

    expect(mocks.resetClientDataState).toHaveBeenCalledWith(queryClient);
    expect(mocks.resetClientSessionState).not.toHaveBeenCalled();
  });

  it("resets client state after a successful erasure", async () => {
    vi.spyOn(adminApi, "expunge").mockResolvedValue({
      success: true,
      requestedScopes: ["chats"],
      completedScopes: ["chats"],
      remainingScopes: [],
      clearedCollections: ["chats"],
    });

    await act(async () => {
      await mutation!.mutateAsync(["chats"]);
    });

    expect(mocks.resetClientDataState).toHaveBeenCalledWith(queryClient);
    expect(mocks.resetClientSessionState).not.toHaveBeenCalled();
  });

  it("does not reset client state for a conservative zero-mutation failure", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats"],
      completedScopes: [],
      remainingScopes: ["chats"],
      failedScope: null,
      clearedCollections: [],
      cause: { code: "remote_runtime_unreachable", message: "Runtime unavailable" },
    };
    vi.spyOn(adminApi, "expunge").mockRejectedValue(new ExpungeError("Runtime unavailable", 503, receipt));

    await act(async () => {
      await mutation!.mutateAsync(["chats"]).catch(() => undefined);
    });

    expect(mocks.resetClientDataState).not.toHaveBeenCalled();
    expect(mocks.resetClientSessionState).not.toHaveBeenCalled();
  });
});

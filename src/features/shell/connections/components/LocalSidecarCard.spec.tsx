import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api/api-errors";
import { localSidecarApi } from "../../../../shared/api/local-sidecar-api";
import { toast } from "sonner";
import { LocalSidecarCard } from "./LocalSidecarCard";

vi.mock("../../../../shared/api/local-sidecar-api", () => ({
  localSidecarApi: {
    status: vi.fn(),
    updateConfig: vi.fn(),
    downloadCurated: vi.fn(),
    start: vi.fn(),
  },
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    list: vi.fn(),
  },
}));

vi.mock("../../../catalog/agents", () => ({
  agentKeys: { all: ["agents"] },
  useAgentConfigs: () => ({ data: [] }),
  useCreateAgent: () => ({ mutateAsync: vi.fn() }),
  useUpdateAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("./LocalSidecarSetupModal", () => ({
  LocalSidecarSetupModal: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("LocalSidecarCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root?.unmount());
    queryClient?.clear();
    root = null;
    queryClient = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("does not toast remote admin errors from the passive status load", async () => {
    vi.mocked(localSidecarApi.status).mockRejectedValue(
      new ApiError("Admin Access secret did not match.", 500, { code: "admin_access_invalid" }),
    );

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <LocalSidecarCard />
        </QueryClientProvider>,
      );
    });
    await flushAsyncWork();

    expect(localSidecarApi.status).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

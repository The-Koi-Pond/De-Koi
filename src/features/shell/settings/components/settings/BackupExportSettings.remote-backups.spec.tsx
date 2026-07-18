import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupApi } from "../../../../../shared/api/profile-api";
import { readAdminSecretStorage } from "../../../../../shared/api/remote-runtime";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { BackupExportSettings } from "./BackupExportSettings";

vi.mock("../../../../../shared/api/profile-api", () => ({
  backupApi: {
    createBackup: vi.fn(),
    deleteBackup: vi.fn(),
    downloadBackup: vi.fn(),
    listBackups: vi.fn(),
  },
  profileApi: {
    exportProfile: vi.fn(),
  },
}));

vi.mock("../../../../../shared/api/remote-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../../../../shared/api/remote-runtime")>(
    "../../../../../shared/api/remote-runtime",
  );
  return {
    ...actual,
    checkRemoteRuntimeHealth: vi.fn(async () => ({
      status: "ok",
      message: "Remote runtime is online.",
      health: { ok: true, runtime: "de-koi-server", writable: true },
    })),
    readAdminSecretStorage: vi.fn(),
    writeAdminSecretStorage: vi.fn(),
  };
});

vi.mock("../../hooks/use-admin-data-reset", () => ({
  useClearAllData: () => ({ isPending: false, mutate: vi.fn() }),
  useExpungeData: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("./UserQuickRepliesManager", () => ({
  UserQuickRepliesManager: () => <div data-testid="quick-replies-manager" />,
}));

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BackupExportSettings remote backups", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let queryClient: QueryClient | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(backupApi.listBackups).mockResolvedValue([]);
    vi.mocked(readAdminSecretStorage).mockReturnValue("");
    useUIStore.setState({ remoteRuntimeUrl: "http://pi:7860" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    queryClient?.clear();
    root = null;
    queryClient = null;
    container?.remove();
    container = null;
    useUIStore.setState({ remoteRuntimeUrl: "" });
    vi.clearAllMocks();
  });

  it("does not list managed backups on remote settings load without Admin Access", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });
    await flushAsyncWork();

    expect(backupApi.listBackups).not.toHaveBeenCalled();
  });
});

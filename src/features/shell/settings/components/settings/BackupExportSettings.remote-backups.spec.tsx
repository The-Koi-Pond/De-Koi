import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTextFileToUserSelectedLocation } from "../../../../../shared/api/file-save-api";
import { backupApi } from "../../../../../shared/api/profile-api";
import { readAdminSecretStorage } from "../../../../../shared/api/remote-runtime";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { BackupExportSettings } from "./BackupExportSettings";

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

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

vi.mock("../../../../../shared/api/file-save-api", () => ({
  saveDownloadPayloadToUserSelectedLocation: vi.fn(),
  saveTextFileToUserSelectedLocation: vi.fn(),
}));

vi.mock("../../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: vi.fn(),
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
    await new Promise((resolve) => window.setTimeout(resolve, 0));
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
    vi.mocked(saveTextFileToUserSelectedLocation).mockResolvedValue("saved");
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    useUIStore.setState({ remoteRuntimeUrl: "http://pi:7860" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    queryClient?.clear();
    root = null;
    queryClient = null;
    container?.remove();
    container = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
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

  it("explains the remote Admin Access requirement before privileged backup actions", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });

    expect(container?.textContent).toContain("Admin Access is required to manage backups on this remote runtime.");
    const createButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Create Managed Backup"),
    );
    const downloadButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Download Backup"),
    );
    expect(createButton?.disabled).toBe(true);
    expect(downloadButton?.disabled).toBe(true);

    const adminButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Open Admin Access"),
    );
    expect(adminButton).toBeDefined();
    act(() => adminButton!.click());
    expect(useUIStore.getState()).toMatchObject({
      settingsTab: "advanced",
      pendingSettingsDestination: "admin-access",
    });
  });

  it("shows that existing backups are loading", async () => {
    vi.mocked(readAdminSecretStorage).mockReturnValue("admin-secret");
    vi.mocked(backupApi.listBackups).mockImplementationOnce(() => new Promise(() => {}));

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });

    expect(container?.textContent).toContain("Loading existing backups");
  });

  it("explains when no managed backups exist yet", async () => {
    vi.mocked(readAdminSecretStorage).mockReturnValue("admin-secret");

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });
    await flushAsyncWork();

    expect(container?.textContent).toContain("No managed backups yet.");
  });

  it("offers Retry when managed backup history fails to load", async () => {
    vi.mocked(readAdminSecretStorage).mockReturnValue("admin-secret");
    vi.mocked(backupApi.listBackups).mockRejectedValueOnce(new Error("remote unavailable")).mockResolvedValueOnce([]);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });
    await flushAsyncWork();

    expect(container?.textContent).toContain("Couldn't load managed backups.");
    const retryButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry"),
    );
    expect(retryButton).toBeDefined();

    await act(async () => {
      retryButton!.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(backupApi.listBackups).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("No managed backups yet.");
  });

  it("labels the safe support export separately from the sensitive recovery export", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });

    expect(container?.textContent).toContain("Export Safe Support State");
    expect(container?.textContent).toContain("Export Sensitive Recovery State");
    expect(container?.textContent).toContain("Safe support state removes stored credentials");
  });

  it("requires confirmation before exporting full-fidelity browser recovery state", async () => {
    window.localStorage.setItem("marinara-admin-secret", "private-admin-secret");
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient!}>
          <BackupExportSettings />
        </QueryClientProvider>,
      );
    });

    const sensitiveButton = Array.from(container!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Export Sensitive Recovery State"),
    );
    expect(sensitiveButton).toBeDefined();

    await act(async () => {
      sensitiveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Export sensitive recovery state?",
        confirmLabel: "Export Sensitive File",
      }),
    );
    expect(saveTextFileToUserSelectedLocation).not.toHaveBeenCalled();

    vi.mocked(showConfirmDialog).mockResolvedValueOnce(true);
    await act(async () => {
      sensitiveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveTextFileToUserSelectedLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringContaining("de-koi-browser-local-state-"),
        content: expect.stringContaining("private-admin-secret"),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Sensitive recovery file exported. Keep it private and do not share it.",
    );
  });
});

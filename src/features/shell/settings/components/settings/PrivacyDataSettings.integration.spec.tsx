import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, ExpungeError, type ExpungeFailureReceipt } from "../../../../../shared/api/admin-api";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { PrivacyDataSettings } from "./PrivacyDataSettings";

vi.mock("./BackupExportSettings", () => ({
  BackupExportSettings: () => <div>Backup settings</div>,
}));

function SettingsRightPanelOwner() {
  const settingsOpen = useUIStore((state) => state.rightPanelOpen && state.rightPanel === "settings");
  return settingsOpen ? <PrivacyDataSettings /> : <div>Settings panel closed</div>;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function findScopeCheckbox(container: HTMLElement, label: string): HTMLInputElement {
  const scopeLabel = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes(label));
  const input = scopeLabel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error(`Missing scope checkbox: ${label}`);
  return input;
}

describe("PrivacyDataSettings expunge reset integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(["chats"], [{ id: "chat-1" }]);
    useUIStore.setState({ rightPanelOpen: true, rightPanel: "settings" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SettingsRightPanelOwner />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    useUIStore.getState().closeRightPanel();
  });

  it("keeps the settings owner mounted so a partial receipt can render and retry after data reset", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats", "media"],
      completedScopes: ["chats"],
      remainingScopes: ["media"],
      failedScope: "media",
      clearedCollections: ["chats"],
      cause: { code: "io_error", message: "media cleanup failed" },
    };
    const expunge = vi.spyOn(adminApi, "expunge").mockRejectedValue(new ExpungeError("Partial erasure", 500, receipt));

    act(() => findScopeCheckbox(container, "Media & Assets").click());
    act(() => findButton(container, "Clear selected data").click());
    await act(async () => findButton(container, "Confirm delete").click());

    await vi.waitFor(() => {
      expect(useUIStore.getState()).toMatchObject({ rightPanelOpen: true, rightPanel: "settings" });
      expect(container.textContent).toContain("Completed: Chats & Messages.");
      expect(container.textContent).toContain("Still to erase: Media & Assets.");
    });
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0);

    act(() => findButton(container, "Retry remaining data").click());

    await vi.waitFor(() => expect(expunge).toHaveBeenNthCalledWith(2, receipt.remainingScopes));
  });
});

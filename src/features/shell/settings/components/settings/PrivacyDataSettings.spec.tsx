import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpungeError, type ExpungeFailureReceipt } from "../../../../../shared/api/admin-api";
import { PrivacyDataSettings } from "./PrivacyDataSettings";

const mocks = vi.hoisted(() => ({
  clearAllMutate: vi.fn(),
  expungeMutate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("../../hooks/use-admin-data-reset", () => ({
  useClearAllData: () => ({ isPending: false, mutate: mocks.clearAllMutate }),
  useExpungeData: () => ({ isPending: false, mutate: mocks.expungeMutate }),
}));

vi.mock("./BackupExportSettings", () => ({
  BackupExportSettings: () => <div>Backup settings</div>,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

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

describe("PrivacyDataSettings selected erasure receipts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows exact partial results, selects only the remainder, and retries only that remainder", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats", "connections", "media"],
      completedScopes: ["chats"],
      remainingScopes: ["connections", "media"],
      failedScope: "connections",
      clearedCollections: ["chats", "connection-folders"],
      cause: { code: "io_error", message: "connection storage failed" },
    };
    const error = new ExpungeError("Partial erasure", 500, receipt);
    mocks.expungeMutate.mockImplementationOnce(
      (_scopes: string[], options: { onError: (cause: unknown) => void; onSettled: () => void }) => {
        options.onError(error);
        options.onSettled();
      },
    );

    await act(async () => root.render(<PrivacyDataSettings />));
    act(() => findScopeCheckbox(container, "Connections").click());
    act(() => findScopeCheckbox(container, "Media & Assets").click());
    act(() => findButton(container, "Clear selected data").click());
    act(() => findButton(container, "Confirm delete").click());

    expect(mocks.expungeMutate).toHaveBeenNthCalledWith(1, ["chats", "connections", "media"], expect.any(Object));
    expect(container.textContent).toContain("Completed: Chats & Messages.");
    expect(container.textContent).toContain("Still to erase: Connections, Media & Assets.");
    expect(findScopeCheckbox(container, "Chats & Messages").checked).toBe(false);
    expect(findScopeCheckbox(container, "Connections").checked).toBe(true);
    expect(findScopeCheckbox(container, "Media & Assets").checked).toBe(true);

    act(() => findButton(container, "Retry remaining data").click());

    expect(mocks.expungeMutate).toHaveBeenNthCalledWith(2, ["connections", "media"], expect.any(Object));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("persists an exact successful result", async () => {
    mocks.expungeMutate.mockImplementationOnce(
      (
        _scopes: string[],
        options: {
          onSuccess: (receipt: unknown) => void;
          onSettled: () => void;
        },
      ) => {
        options.onSuccess({
          success: true,
          requestedScopes: ["chats"],
          completedScopes: ["chats"],
          remainingScopes: [],
          clearedCollections: ["chats", "messages"],
        });
        options.onSettled();
      },
    );

    await act(async () => root.render(<PrivacyDataSettings />));
    act(() => findButton(container, "Clear selected data").click());
    act(() => findButton(container, "Confirm delete").click());

    expect(container.textContent).toContain("Selected data erasure completed.");
    expect(container.textContent).toContain("Erased: Chats & Messages.");
    expect(findScopeCheckbox(container, "Chats & Messages").checked).toBe(false);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Selected De-Koi data was permanently erased.");
  });

  it("shows and retries an exact modern first-scope failure even before any mutation", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats", "connections"],
      completedScopes: [],
      remainingScopes: ["chats", "connections"],
      failedScope: "chats",
      clearedCollections: [],
      cause: { code: "io_error", message: "chat storage failed" },
    };
    mocks.expungeMutate.mockImplementationOnce(
      (_scopes: string[], options: { onError: (cause: unknown) => void; onSettled: () => void }) => {
        options.onError(new ExpungeError("First scope failed", 500, receipt));
        options.onSettled();
      },
    );

    await act(async () => root.render(<PrivacyDataSettings />));
    act(() => findScopeCheckbox(container, "Connections").click());
    act(() => findButton(container, "Clear selected data").click());
    act(() => findButton(container, "Confirm delete").click());

    expect(container.textContent).toContain("Selected data erasure could not start.");
    expect(container.textContent).not.toContain("Selected data erasure partially completed.");
    expect(container.textContent).toContain("Completed: None.");
    expect(container.textContent).toContain("Still to erase: Chats & Messages, Connections.");
    expect(findButton(container, "Retry remaining data")).toBeTruthy();

    act(() => findButton(container, "Retry remaining data").click());

    expect(mocks.expungeMutate).toHaveBeenNthCalledWith(2, receipt.remainingScopes, expect.any(Object));
  });

  it("keeps a zero-mutation failure generic and preserves the selection", async () => {
    const receipt: ExpungeFailureReceipt = {
      success: false,
      requestedScopes: ["chats"],
      completedScopes: [],
      remainingScopes: ["chats"],
      failedScope: null,
      clearedCollections: [],
      cause: { code: "remote_runtime_unreachable", message: "Runtime unavailable" },
    };
    mocks.expungeMutate.mockImplementationOnce(
      (_scopes: string[], options: { onError: (cause: unknown) => void; onSettled: () => void }) => {
        options.onError(new ExpungeError("Runtime unavailable", 503, receipt));
        options.onSettled();
      },
    );

    await act(async () => root.render(<PrivacyDataSettings />));
    act(() => findButton(container, "Clear selected data").click());
    act(() => findButton(container, "Confirm delete").click());

    expect(container.textContent).not.toContain("partially completed");
    expect(container.textContent).not.toContain("Retry remaining data");
    expect(findScopeCheckbox(container, "Chats & Messages").checked).toBe(true);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "De-Koi couldn't finish erasing the selected data. Some items may remain.",
    );
  });
});

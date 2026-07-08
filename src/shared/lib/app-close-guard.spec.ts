import { afterEach, describe, expect, it, vi } from "vitest";

const dialogs = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(),
}));

const windowControls = vi.hoisted(() => ({
  closeDesktopWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock("./app-dialogs", () => dialogs);
vi.mock("../api/window-controls-api", () => windowControls);

import {
  confirmDiscardPendingAppWork,
  registerAppCloseGuard,
  requestGuardedAppClose,
} from "./app-close-guard";

const cleanups: Array<() => void> = [];

describe("app close guard", () => {
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    vi.clearAllMocks();
  });

  it("flushes pending guards before prompting", async () => {
    let dirty = true;
    cleanups.push(
      registerAppCloseGuard({
        label: "Draft",
        hasPendingWork: () => dirty,
        flush: () => {
          dirty = false;
        },
      }),
    );

    await expect(confirmDiscardPendingAppWork()).resolves.toBe(true);
    expect(dialogs.showConfirmDialog).not.toHaveBeenCalled();
  });

  it("honors cancellation when pending work remains", async () => {
    dialogs.showConfirmDialog.mockResolvedValue(false);
    cleanups.push(
      registerAppCloseGuard({
        label: "Attachment",
        hasPendingWork: () => true,
        message: "Attachment is not saved.",
      }),
    );

    await expect(confirmDiscardPendingAppWork({ title: "Switch chats?" })).resolves.toBe(false);
    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Switch chats?",
        message: "Attachment is not saved.",
      }),
    );
  });

  it("does not force-close the window when the user cancels", async () => {
    dialogs.showConfirmDialog.mockResolvedValue(false);
    cleanups.push(
      registerAppCloseGuard({
        label: "Attachment",
        hasPendingWork: () => true,
      }),
    );

    await expect(requestGuardedAppClose()).resolves.toBe(false);
    expect(windowControls.closeDesktopWindow).not.toHaveBeenCalled();
  });
});
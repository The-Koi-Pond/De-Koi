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
  hasPendingAppCloseWork,
  registerAppCloseGuard,
  registerBrowserBeforeUnloadGuard,
  registerEditorDirtyAppCloseGuard,
  registerEphemeralAttachmentDraftAppCloseGuard,
  requestGuardedAppClose,
} from "./app-close-guard";
import { ephemeralAttachmentDrafts } from "./ephemeral-attachment-drafts";
import { useUIStore } from "../stores/ui.store";

const cleanups: Array<() => void> = [];

describe("app close guard", () => {
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    vi.clearAllMocks();
    useUIStore.setState({ editorDirty: false });
    ephemeralAttachmentDrafts.clear("roleplay", "roleplay-a");
  });

  it("tracks the central editor dirty state as pending app-close work", () => {
    cleanups.push(registerEditorDirtyAppCloseGuard(() => useUIStore.getState().editorDirty));

    expect(hasPendingAppCloseWork()).toBe(false);

    useUIStore.setState({ editorDirty: true });

    expect(hasPendingAppCloseWork()).toBe(true);
  });

  it("marks browser unload as cancelable while app-close work is pending", () => {
    cleanups.push(
      registerAppCloseGuard({
        label: "Draft",
        hasPendingWork: () => true,
      }),
    );
    cleanups.push(registerBrowserBeforeUnloadGuard(window));
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("tracks cached roleplay attachments for close without blocking safe navigation", async () => {
    cleanups.push(registerEphemeralAttachmentDraftAppCloseGuard("roleplay"));
    dialogs.showConfirmDialog.mockResolvedValue(false);

    ephemeralAttachmentDrafts.replace("roleplay", "roleplay-a", [
      { type: "image/png", data: "data:image/png;base64,a", name: "a.png" },
    ]);

    expect(hasPendingAppCloseWork()).toBe(true);
    await expect(confirmDiscardPendingAppWork({ purpose: "navigation" })).resolves.toBe(true);
    expect(dialogs.showConfirmDialog).not.toHaveBeenCalled();

    await expect(confirmDiscardPendingAppWork({ purpose: "app-close" })).resolves.toBe(false);
    expect(dialogs.showConfirmDialog).toHaveBeenCalledTimes(1);

    ephemeralAttachmentDrafts.clear("roleplay", "roleplay-a");
    expect(hasPendingAppCloseWork()).toBe(false);
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

    await expect(confirmDiscardPendingAppWork({ purpose: "navigation", title: "Switch chats?" })).resolves.toBe(false);
    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Switch chats?",
        message: "Attachment is not saved.",
      }),
    );
  });

  it.each([
    ["chat switch", { purpose: "navigation" as const, title: "Switch chats?", confirmLabel: "Switch anyway" }],
    ["mode switch", { purpose: "navigation" as const, title: "Switch chat modes?", confirmLabel: "Switch anyway" }],
  ])("blocks %s when pending work remains and the user cancels", async (_transition, options) => {
    dialogs.showConfirmDialog.mockResolvedValue(false);
    cleanups.push(
      registerAppCloseGuard({
        label: "Attachment",
        hasPendingWork: () => true,
      }),
    );

    await expect(confirmDiscardPendingAppWork(options)).resolves.toBe(false);
    expect(dialogs.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: options.title,
        confirmLabel: options.confirmLabel,
      }),
    );
  });

  it("flushes pending work before force-closing the desktop window", async () => {
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

    await expect(requestGuardedAppClose()).resolves.toBe(true);
    expect(dialogs.showConfirmDialog).not.toHaveBeenCalled();
    expect(windowControls.closeDesktopWindow).toHaveBeenCalledWith({ force: true });
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

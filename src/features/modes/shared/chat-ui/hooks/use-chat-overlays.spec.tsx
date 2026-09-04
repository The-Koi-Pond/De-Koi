import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DISCOVERY_APP_EVENT } from "../../../../../shared/lib/discovery-navigation";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useChatOverlays } from "./use-chat-overlays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function OverlayHarness() {
  const overlays = useChatOverlays("chat-1");
  return (
    <>
      <button data-testid="open-settings" type="button" onClick={overlays.openSettings}>
        Open settings
      </button>
      <button data-testid="close-settings" type="button" onClick={overlays.closeSettings}>
        {overlays.settingsOpen ? "Close settings" : "Settings closed"}
      </button>
      <output data-testid="wizard-state">{overlays.wizardOpen ? "Wizard open" : "Wizard closed"}</output>
      <output data-testid="setup-chat-id">{overlays.newChatSetupChatId}</output>
      <output data-testid="settings-destination">{overlays.pendingDiscoverySection}</output>
    </>
  );
}

describe("useChatOverlays discovery reveal lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let disconnectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useChatStore.setState({
      newChatSetupIntent: null,
      shouldOpenSettings: false,
      shouldOpenWizard: false,
      shouldOpenWizardInShortcutMode: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");
    root = createRoot(container);
    act(() => root.render(<OverlayHarness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lets manual settings supersede a pending fresh-chat setup", () => {
    let scheduledFrame: FrameRequestCallback | null = null;
    let scheduledIdle: (() => void) | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        scheduledIdle = callback;
        return 2;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    act(() => {
      useChatStore.getState().setNewChatSetupIntent({
        chatId: "chat-1",
        openSettings: true,
        openWizard: true,
        shortcutMode: false,
      });
    });

    expect(container.querySelector('[data-testid="setup-chat-id"]')?.textContent).toBe("chat-1");

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="open-settings"]')?.click());
    act(() => scheduledFrame?.(0));
    act(() => scheduledIdle?.());

    expect(container.textContent).toContain("Close settings");
    expect(container.querySelector('[data-testid="wizard-state"]')?.textContent).toBe("Wizard closed");
    expect(container.querySelector('[data-testid="setup-chat-id"]')?.textContent).toBe("");
    expect(useChatStore.getState().newChatSetupIntent).toBeNull();
  });

  it("disconnects a pending reveal immediately when settings close", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DISCOVERY_APP_EVENT, {
          detail: { type: "open-chat-destination", destination: "chat-settings-continuity" },
        }),
      );
    });

    expect(container.textContent).toContain("Close settings");
    expect(disconnectSpy).not.toHaveBeenCalled();

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="close-settings"]')?.click());

    expect(container.textContent).toContain("Settings closed");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("disconnects a pending reveal when the discovery destination changes", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DISCOVERY_APP_EVENT, {
          detail: { type: "open-chat-destination", destination: "chat-settings-continuity" },
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DISCOVERY_APP_EVENT, {
          detail: { type: "open-chat-destination", destination: "chat-settings" },
        }),
      );
    });

    expect(container.textContent).toContain("Close settings");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("keeps the active reveal alive when the same destination is requested again", () => {
    const event = new CustomEvent(DISCOVERY_APP_EVENT, {
      detail: { type: "open-chat-destination", destination: "chat-settings-continuity" },
    });

    act(() => window.dispatchEvent(event));
    act(() => window.dispatchEvent(event));

    expect(container.textContent).toContain("Close settings");
    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it("opens settings and reveals the Roleplay workflow chooser destination", () => {
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DISCOVERY_APP_EVENT, {
          detail: { type: "open-chat-destination", destination: "chat-settings-workflow-profile" as never },
        }),
      );
    });

    expect(container.textContent).toContain("Close settings");
    expect(container.querySelector('[data-testid="settings-destination"]')?.textContent).toBe(
      "chat-settings-workflow-profile",
    );
  });
});

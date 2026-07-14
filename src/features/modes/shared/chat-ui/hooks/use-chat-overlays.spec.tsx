import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DISCOVERY_APP_EVENT } from "../../../../../shared/lib/discovery-navigation";
import { useChatOverlays } from "./use-chat-overlays";

function OverlayHarness() {
  const overlays = useChatOverlays("chat-1");
  return (
    <button type="button" onClick={overlays.closeSettings}>
      {overlays.settingsOpen ? "Close settings" : "Settings closed"}
    </button>
  );
}

describe("useChatOverlays discovery reveal lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let disconnectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

    act(() => container.querySelector("button")?.click());

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
});

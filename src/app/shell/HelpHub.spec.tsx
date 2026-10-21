import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpHub } from "./HelpHub";
import { DISCOVERY_APP_EVENT } from "../../shared/lib/discovery-navigation";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { useUIStore } from "../../shared/stores/ui.store";

const mocks = vi.hoisted(() => ({
  openBugReport: vi.fn(),
  openExternalUrl: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../shared/config/support-links", () => ({
  SUPPORT_LINKS: {
    bugReportUrl: "https://example.test/issues/new",
    docsUrl: "https://example.test/docs",
    supportContact: "mailto:support@example.test",
  },
}));

vi.mock("../../shared/lib/support-report", () => ({
  openBugReport: mocks.openBugReport,
}));

vi.mock("../../shared/api/external-link-api", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("HelpHub feature discovery", () => {
  it("offers a direct Find a feature action", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenDiscover = vi.fn();
    window.addEventListener(DISCOVERY_APP_EVENT, onOpenDiscover);
    useUIStore.setState({ rightPanelOpen: true, rightPanel: "help" });

    act(() => {
      root.render(<HelpHub />);
    });

    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Find a feature"),
    );
    expect(button).toBeTruthy();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenDiscover).toHaveBeenCalledOnce();
    expect(useUIStore.getState().rightPanelOpen).toBe(false);

    act(() => root.unmount());
    window.removeEventListener(DISCOVERY_APP_EVENT, onOpenDiscover);
    container.remove();
  });

  it("Get started goes home and brings back an unfinished, dismissed setup", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDiscoveryEvent = vi.fn();
    window.addEventListener(DISCOVERY_APP_EVENT, onDiscoveryEvent);
    useUIStore.setState({ rightPanelOpen: true, rightPanel: "help" });
    useChatStore.getState().setActiveChatId("chat-1");
    useSetupJourneyStore.setState({
      intent: {
        journeyId: "journey-1",
        mode: "roleplay",
        originCharacterId: null,
        selectedConnectionId: null,
        dismissed: true,
        completed: false,
      },
    });

    act(() => {
      root.render(<HelpHub />);
    });
    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Get started"),
    );
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(useUIStore.getState().rightPanelOpen).toBe(false);
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(useSetupJourneyStore.getState().intent?.dismissed).toBe(false);
    expect(onDiscoveryEvent.mock.calls.map(([event]) => (event as CustomEvent).detail)).toContainEqual({
      type: "go-home",
    });

    act(() => root.unmount());
    window.removeEventListener(DISCOVERY_APP_EVENT, onDiscoveryEvent);
    container.remove();
    useSetupJourneyStore.setState({ intent: null });
  });

  it("explains how to recover when support destinations cannot open", async () => {
    mocks.openBugReport.mockRejectedValue(new Error("popup blocked"));
    mocks.openExternalUrl.mockRejectedValue(new Error("popup blocked"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<HelpHub />);
    });

    for (const label of ["Report a bug", "FAQ and docs", "Contact support"]) {
      const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
      expect(button, label).toBeDefined();
      await act(async () => {
        button!.click();
        await Promise.resolve();
      });
    }

    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't open the bug report. Allow pop-ups and try again.");
    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't open the documentation. Allow pop-ups and try again.");
    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't open the support contact. Allow pop-ups and try again.");

    act(() => root.unmount());
    container.remove();
  });
});

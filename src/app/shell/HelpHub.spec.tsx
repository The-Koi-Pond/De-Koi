import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpHub } from "./HelpHub";

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

    act(() => {
      root.render(
        <HelpHub
          open
          onClose={vi.fn()}
          onOpenHealth={vi.fn()}
          onReplayOnboarding={vi.fn()}
          onOpenDiscover={onOpenDiscover}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Find a feature"),
    );
    expect(button).toBeTruthy();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenDiscover).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });

  it("explains how to recover when support destinations cannot open", async () => {
    mocks.openBugReport.mockRejectedValue(new Error("popup blocked"));
    mocks.openExternalUrl.mockRejectedValue(new Error("popup blocked"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<HelpHub open onClose={vi.fn()} onOpenHealth={vi.fn()} onReplayOnboarding={vi.fn()} />);
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

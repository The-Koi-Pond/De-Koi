import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeWindowErrorEvent, GlobalErrorBoundary } from "./GlobalErrorBoundary";
import { openBugReport } from "../shared/lib/support-report";

vi.mock("../shared/lib/support-report", () => ({
  openBugReport: vi.fn(() => Promise.resolve("https://github.com/The-Koi-Pond/De-Koi/issues/new")),
}));

function ThrowingChild() {
  throw new Error("invoke failed: status 500 at /api/invoke");
  return null;
}

describe("describeWindowErrorEvent", () => {
  it("keeps message-only window errors from gaining a fake stack", () => {
    const details = describeWindowErrorEvent(
      new ErrorEvent("error", {
        message: "Script failed.",
        filename: "https://example.test/app.js",
        lineno: 12,
        colno: 4,
      }),
    );

    expect(details.message).toBe("Script failed.");
    expect(details.stack).toBe("");
    expect(details.filename).toBe("https://example.test/app.js");
    expect(details.lineno).toBe(12);
    expect(details.colno).toBe(4);
  });
});

describe("GlobalErrorBoundary", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let previousActEnvironment: boolean | undefined;
  const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    previousActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container.remove();
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("shows recovery copy without rendering raw exception details", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(GlobalErrorBoundary, {
          onReload: () => undefined,
          children: createElement(ThrowingChild),
        }),
      );
    });

    expect(container.textContent).toContain("De-Koi hit a display problem.");
    expect(container.textContent).toContain("Reload De-Koi");
    expect(container.textContent).toContain("Copy report");
    expect(container.textContent).toContain("Report bug");
    expect(container.textContent).not.toContain("invoke failed");
    expect(container.textContent).not.toContain("Debug details");
  });

  it("opens a bug report with copied crash details", async () => {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(GlobalErrorBoundary, {
          onReload: () => undefined,
          children: createElement(ThrowingChild),
        }),
      );
    });

    const reportButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Report bug"),
    );
    expect(reportButton).toBeTruthy();

    await act(async () => {
      reportButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openBugReport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "crash-screen",
        reportText: expect.stringContaining("invoke failed"),
      }),
    );
  });
});

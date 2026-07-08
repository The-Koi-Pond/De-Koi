import { beforeEach, describe, expect, it, vi } from "vitest";

const { openExternalUrlMock } = vi.hoisted(() => ({
  openExternalUrlMock: vi.fn(),
}));

vi.mock("../api/external-link-api", () => ({
  openExternalUrl: openExternalUrlMock,
}));

import { buildBugReportUrl, buildSupportReportText, openBugReport } from "./support-report";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

describe("support report helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    openExternalUrlMock.mockReset();
    setClipboard(undefined);
  });

  it("builds a short bug-report URL skeleton without embedding the full report payload", () => {
    const url = buildBugReportUrl({
      source: "health-diagnostics",
      appVersion: "1.6.1",
      platform: {
        os: "Windows",
        userAgent: "Mozilla/5.0 Windows",
        language: "en-US",
      },
      reportText: "x".repeat(2000),
    });

    expect(url).toContain("https://github.com/The-Koi-Pond/De-Koi/issues/new?");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("title")).toBe("[Bug]: ");
    const body = parsed.searchParams.get("body") ?? "";
    expect(body).toContain("Paste the copied report below");
    expect(body).toContain("App version: 1.6.1");
    expect(body).toContain("Source: health-diagnostics");
    expect(body).toContain("OS: Windows");
    expect(url).not.toContain("x".repeat(100));
    expect(url.length).toBeLessThan(1200);
  });

  it("adds app version and platform details to copied crash reports", () => {
    const report = buildSupportReportText({
      source: "crash-screen",
      appVersion: "1.6.1",
      platform: {
        os: "macOS",
        userAgent: "Mozilla/5.0 Mac",
        language: "en-US",
      },
      reportText: "Error: render failed",
    });

    expect(report).toContain("De-Koi support report");
    expect(report).toContain("Source: crash-screen");
    expect(report).toContain("App version: 1.6.1");
    expect(report).toContain("OS: macOS");
    expect(report).toContain("Error: render failed");
  });

  it("falls back to a manual copy prompt when clipboard is unavailable", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("");

    const url = await openBugReport({
      source: "query-error",
      appVersion: "1.6.1",
      platform: {
        os: "Windows",
        userAgent: "Mozilla/5.0 Windows",
        language: "en-US",
      },
      reportText: "Fetch failed",
    });

    expect(promptSpy).toHaveBeenCalledWith(
      "Clipboard is unavailable. Copy this De-Koi support report before submitting:",
      expect.stringContaining("Fetch failed"),
    );
    expect(openExternalUrlMock).toHaveBeenCalledWith(url);
    expect(url).toContain("https://github.com/The-Koi-Pond/De-Koi/issues/new?");
  });
});
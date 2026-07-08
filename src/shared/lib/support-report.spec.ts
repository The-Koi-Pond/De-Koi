import { describe, expect, it } from "vitest";
import { buildBugReportUrl, buildSupportReportText } from "./support-report";

describe("support report helpers", () => {
  it("builds a short bug-report URL skeleton without embedding the full report payload", () => {
    const url = buildBugReportUrl({
      bugReportUrl: "https://github.com/The-Koi-Pond/De-Koi/issues/new",
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
});

import { describe, expect, it } from "vitest";
import {
  buildTroubleshootingPacket,
  diagnosticsOverallStatus,
  redactDiagnosticsValue,
  type DiagnosticsSnapshot,
} from "./diagnostics-model";

describe("diagnostics model", () => {
  it("redacts secrets, URL credentials, data URIs, long base64 strings, stacks, and local paths", () => {
    const redacted = redactDiagnosticsValue({
      apiKey: "sk-live-secret",
      authorization: "Bearer hidden",
      cookie: "session=hidden",
      normal: "kept",
      url: "https://user:pass@example.test/runtime?api_key=hidden&ok=1",
      path: "C:\\Users\\celia\\AppData\\Roaming\\De-Koi\\sidecar.log",
      dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
      blob: "VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQtc2hhcGVkIHN0cmluZyB3aXRob3V0IHVzZXItdmFsdWU=",
      stack: ["Error: boom", "at first", "at second", "at third", "at fourth", "at fifth", "at sixth"].join("\n"),
      nested: {
        token: "provider-token",
        safe: "provider name",
      },
    }) as Record<string, unknown>;

    const rendered = JSON.stringify(redacted);
    expect(redacted.normal).toBe("kept");
    expect(rendered).toContain("provider name");
    expect(rendered).not.toContain("sk-live-secret");
    expect(rendered).not.toContain("Bearer hidden");
    expect(rendered).not.toContain("session=hidden");
    expect(rendered).not.toContain("user:pass");
    expect(rendered).not.toContain("api_key=hidden");
    expect(rendered).not.toContain("C:\\Users\\celia");
    expect(rendered).not.toContain("data:image/png");
    expect(rendered).not.toContain("VGhpcy");
    expect(rendered).not.toContain("at sixth");
  });

  it("builds a shareable packet that preserves useful non-secret state", () => {
    const snapshot: DiagnosticsSnapshot = {
      generatedAt: "2026-06-22T20:00:00.000Z",
      appVersion: "1.6.1",
      runtimeMode: "embedded",
      overallStatus: "warning",
      sections: [
        {
          id: "runtime",
          title: "Runtime",
          status: "ok",
          items: [
            {
              id: "embedded-runtime",
              label: "Embedded runtime",
              status: "ok",
              summary: "Embedded Tauri runtime active.",
              details: { runtime: "tauri", adminSecret: "do-not-share" },
            },
          ],
        },
        {
          id: "providers",
          title: "Providers",
          status: "warning",
          items: [
            {
              id: "conn-1",
              label: "Main Model",
              status: "warning",
              summary: "Probe has not been run.",
              details: {
                provider: "openai",
                model: "gpt-test",
                apiKey: "sk-secret",
                baseUrl: "https://token:secret@example.test/v1?token=hidden",
              },
            },
          ],
        },
      ],
      recentDiagnostics: [
        {
          id: "diag-1",
          level: "error",
          source: "window",
          message: "Unhandled promise rejection",
          timestamp: "2026-06-22T19:59:00.000Z",
          details: {
            stack: ["Error: failed", "at first", "at second", "at third", "at fourth", "at fifth"].join("\n"),
          },
        },
      ],
    };

    const packet = buildTroubleshootingPacket(snapshot, new Date("2026-06-22T20:01:00.000Z"));
    const rendered = JSON.stringify(packet);

    expect(packet.schema).toBe("de-koi-diagnostics.v1");
    expect(packet.generatedAt).toBe("2026-06-22T20:01:00.000Z");
    expect(packet.appVersion).toBe("1.6.1");
    expect(rendered).toContain("Main Model");
    expect(rendered).toContain("gpt-test");
    expect(rendered).not.toContain("sk-secret");
    expect(rendered).not.toContain("token:secret");
    expect(rendered).not.toContain("token=hidden");
    expect(rendered).not.toContain("do-not-share");
  });

  it("rolls section status up by severity", () => {
    expect(diagnosticsOverallStatus([{ status: "ok" }, { status: "warning" }, { status: "degraded" }])).toBe(
      "warning",
    );
    expect(diagnosticsOverallStatus([{ status: "ok" }, { status: "error" }, { status: "warning" }])).toBe("error");
    expect(diagnosticsOverallStatus([{ status: "ok" }, { status: "ok" }])).toBe("ok");
    expect(diagnosticsOverallStatus([])).toBe("unknown");
  });
});

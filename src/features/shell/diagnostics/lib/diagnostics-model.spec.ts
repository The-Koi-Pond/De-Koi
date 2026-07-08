import { describe, expect, it } from "vitest";
import {
  buildGenerationTimingSection,
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

  it("summarizes recent generation timing diagnostics", () => {
    const section = buildGenerationTimingSection([
      {
        id: "diag-model",
        level: "info",
        source: "generation-timing",
        message: "model-call completed in 12000ms",
        timestamp: "2026-06-22T20:00:04.000Z",
        details: {
          kind: "timing",
          name: "model-call",
          durationMs: 12000,
          chatId: "chat-1",
          chatMode: "roleplay",
          groupChatMode: "merged",
          characterCount: 3,
          targetCharacterId: null,
          promptMessageCount: 18,
        },
      },
      {
        id: "diag-assemble",
        level: "info",
        source: "generation-timing",
        message: "assemble-prompt completed in 450ms",
        timestamp: "2026-06-22T20:00:03.000Z",
        details: {
          kind: "timing",
          name: "assemble-prompt",
          durationMs: 450,
          chatId: "chat-1",
          chatMode: "roleplay",
          groupChatMode: "merged",
          characterCount: 3,
          targetCharacterId: null,
          messageCount: 14,
          promptMessageCount: 18,
        },
      },
    ]);

    expect(section).toEqual(
      expect.objectContaining({
        id: "generation-timing",
        title: "Generation Timing",
        status: "warning",
      }),
    );
    expect(section.items[0]).toEqual(
      expect.objectContaining({
        id: "generation-timing-slowest",
        label: "Slowest recent generation stage",
        status: "warning",
        summary: "model-call took 12.0s in roleplay merged mode with 3 characters.",
        details: expect.objectContaining({
          slowestStage: "model-call",
          durationMs: 12000,
          chatMode: "roleplay",
          groupChatMode: "merged",
          characterCount: 3,
          promptMessageCount: 18,
        }),
      }),
    );
  });

  it("explains when no generation timing diagnostics have been captured", () => {
    const section = buildGenerationTimingSection([]);

    expect(section).toEqual({
      id: "generation-timing",
      title: "Generation Timing",
      status: "unknown",
      items: [
        {
          id: "generation-timing-empty",
          label: "Generation timings",
          status: "unknown",
          summary: "No generation timing diagnostics captured yet. Enable debug mode and run a generation.",
        },
      ],
    });
  });
  it("builds a shareable packet that preserves useful non-secret state", () => {
    const snapshot: DiagnosticsSnapshot = {
      generatedAt: "2026-06-22T20:00:00.000Z",
      appVersion: "1.6.1",
      platform: {
        os: "Windows",
        userAgent: "Mozilla/5.0 C:\\Users\\celia\\AppData\\Local",
        language: "en-US",
      },
      logTail: {
        available: true,
        path: "C:\\Users\\celia\\AppData\\Roaming\\De-Koi\\sidecar.log",
        lines: ["server started", "apiKey=sk-secret", "ready"],
        truncated: false,
      },
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
    expect(packet.platform.os).toBe("Windows");
    expect(packet.logTail?.available).toBe(true);
    expect(rendered).toContain("Main Model");
    expect(rendered).toContain("gpt-test");
    expect(rendered).toContain("server started");
    expect(rendered).toContain("ready");
    expect(rendered).not.toContain("sk-secret");
    expect(rendered).not.toContain("apiKey=sk-secret");
    expect(rendered).not.toContain("C:\\Users\\celia");
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

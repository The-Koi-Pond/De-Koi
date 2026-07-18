import { describe, expect, it } from "vitest";
import { buildBrowserStateExportPayload } from "./browser-state-export";

const exportedAt = "2026-07-18T14:00:00.000Z";

describe("buildBrowserStateExportPayload", () => {
  it("omits admin secrets and redacts credential-bearing URLs from a safe support export", () => {
    const payload = buildBrowserStateExportPayload({
      mode: "safe",
      exportedAt,
      origin: "https://app.example",
      localStorage: {
        "marinara-admin-secret": "current-admin-secret",
        marinara_admin_secret: "legacy-admin-secret",
        "de-koi-ui": JSON.stringify({
          state: {
            remoteRuntimeUrl: "https://alice:basic-password@pi.example:7860/api",
            adminSecret: "nested-admin-secret",
            theme: "pond",
          },
        }),
        "direct-runtime-url": "http://operator:direct-password@localhost:4317/",
      },
      sessionStorage: {
        nested: JSON.stringify({
          endpoint: "https://session-user:session-password@example.test/runtime",
        }),
      },
    });

    expect(payload.schema).toBe("de-koi-browser-support-state-v1");
    expect(payload.localStorage).not.toHaveProperty("marinara-admin-secret");
    expect(payload.localStorage).not.toHaveProperty("marinara_admin_secret");
    expect(payload.localStorage["direct-runtime-url"]).toBe("http://localhost:4317/");

    expect(JSON.parse(payload.localStorage["de-koi-ui"] ?? "{}")).toEqual({
      state: {
        remoteRuntimeUrl: "https://pi.example:7860/api",
        adminSecret: "[redacted]",
        theme: "pond",
      },
    });
    expect(JSON.parse(payload.sessionStorage.nested ?? "{}")).toEqual({
      endpoint: "https://example.test/runtime",
    });

    const rendered = JSON.stringify(payload);
    for (const secret of [
      "current-admin-secret",
      "legacy-admin-secret",
      "nested-admin-secret",
      "basic-password",
      "direct-password",
      "session-password",
    ]) {
      expect(rendered).not.toContain(secret);
    }
  });

  it("preserves full-fidelity browser storage for a sensitive recovery export", () => {
    const localStorage = {
      "marinara-admin-secret": "current-admin-secret",
      "de-koi-ui": JSON.stringify({
        state: { remoteRuntimeUrl: "https://alice:basic-password@pi.example:7860/api" },
      }),
    };
    const sessionStorage = { draft: "keep exactly" };

    expect(
      buildBrowserStateExportPayload({
        mode: "recovery",
        exportedAt,
        origin: "https://app.example",
        localStorage,
        sessionStorage,
      }),
    ).toEqual({
      schema: "de-koi-browser-local-state-v1",
      exportedAt,
      origin: "https://app.example",
      localStorage,
      sessionStorage,
    });
  });
});

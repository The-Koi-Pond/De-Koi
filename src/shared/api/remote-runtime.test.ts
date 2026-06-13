import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRemoteRuntimeHealth } from "./remote-runtime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("checkRemoteRuntimeHealth", () => {
  it("accepts current De-Koi server health responses before probing invoke readiness", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, runtime: "de-koi-server", writable: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock;

    const result = await checkRemoteRuntimeHealth("http://127.0.0.1:7860");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error(`Expected ok health, got ${result.status}`);
    expect(result.health.runtime).toBe("de-koi-server");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:7860/health?probe=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:7860/api/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

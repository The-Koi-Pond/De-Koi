import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRemoteRuntimeHealth } from "./remote-runtime";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function stubFetch(responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("checkRemoteRuntimeHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the De-Koi server health marker", async () => {
    const fetchMock = stubFetch([
      jsonResponse({ ok: true, runtime: "de-koi-server", writable: true }),
      jsonResponse([]),
    ]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toMatchObject({
      status: "ok",
      health: { runtime: "de-koi-server" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3080/health?probe=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3080/api/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps accepting the legacy Marinara server health marker", async () => {
    stubFetch([
      jsonResponse({ ok: true, runtime: "marinara-server", writable: true }),
      jsonResponse([]),
    ]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toMatchObject({
      status: "ok",
      health: { runtime: "marinara-server" },
    });
  });

  it("rejects unrelated health payloads before invoking the API", async () => {
    const fetchMock = stubFetch([
      jsonResponse({ ok: true, runtime: "other-server", writable: true }),
    ]);

    await expect(checkRemoteRuntimeHealth("http://127.0.0.1:3080")).resolves.toEqual({
      status: "unreachable",
      message: "Remote runtime did not return a compatible health response.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

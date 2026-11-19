import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(async (_path: string): Promise<unknown> => null),
  post: vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => null),
  loadUrlBlob: vi.fn(async (_src: string) => new Blob(["plain"], { type: "image/webp" })),
}));

vi.mock("../../../../shared/api/bot-browser-command-api", () => ({
  botBrowserCommandApi: { get: api.get, post: api.post },
}));
vi.mock("../../../../shared/lib/url-blob", () => ({ loadUrlBlob: api.loadUrlBlob }));

import { ApiError } from "../../../../shared/api/api-errors";
import { binaryReplyToBlob, fetchBotBrowserAssetBlob, searchJannyWithFallback } from "./site-api";

async function textOf(blob: Blob) {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

const HELLO_BASE64 = btoa("hello");

describe("binary replies", () => {
  it("reads { base64, mimeType }", async () => {
    const blob = binaryReplyToBlob({ base64: HELLO_BASE64, mimeType: "image/png" });
    expect(blob.type).toBe("image/png");
    expect(await textOf(blob)).toBe("hello");
  });

  it("reads data, body, contentType and type as the other names", async () => {
    const fromData = binaryReplyToBlob({ data: HELLO_BASE64, contentType: "image/webp" });
    const fromBody = binaryReplyToBlob({ body: HELLO_BASE64, type: "image/jpeg" });
    expect([fromData.type, await textOf(fromData)]).toEqual(["image/webp", "hello"]);
    expect([fromBody.type, await textOf(fromBody)]).toEqual(["image/jpeg", "hello"]);
  });

  it("lets a data: URL bring its own type", async () => {
    const blob = binaryReplyToBlob({ base64: `data:image/gif;base64,${HELLO_BASE64}`, mimeType: "image/png" });
    expect(blob.type).toBe("image/gif");
    expect(await textOf(blob)).toBe("hello");
  });

  it("reads a plain string as the bytes, and a plain data: URL string", async () => {
    expect(await textOf(binaryReplyToBlob(HELLO_BASE64))).toBe("hello");
    const fromUrl = binaryReplyToBlob(`data:image/png;base64,${HELLO_BASE64}`);
    expect([fromUrl.type, await textOf(fromUrl)]).toEqual(["image/png", "hello"]);
  });

  it("treats anything else as JSON text", async () => {
    const blob = binaryReplyToBlob({ ok: true });
    expect(blob.type).toBe("application/json");
    expect(await textOf(blob)).toBe('{"ok":true}');
  });
});

describe("card pictures", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.loadUrlBlob.mockClear();
  });

  it("fetches tauri-api: sources through Rust and returns their Blob", async () => {
    api.get.mockResolvedValueOnce({ base64: HELLO_BASE64, mimeType: "image/webp" });
    const blob = await fetchBotBrowserAssetBlob("tauri-api:/bot-browser/chub/avatar/maker/card");
    expect(api.get).toHaveBeenCalledWith("/bot-browser/chub/avatar/maker/card");
    expect([blob.type, await textOf(blob)]).toEqual(["image/webp", "hello"]);
  });

  it("loads other sources as ordinary URLs", async () => {
    const blob = await fetchBotBrowserAssetBlob("https://example.com/a.webp");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.loadUrlBlob).toHaveBeenCalledWith("https://example.com/a.webp");
    expect(await textOf(blob)).toBe("plain");
  });
});

describe("JannyAI browser fallback", () => {
  const body = { queries: [{ indexUid: "janny-characters", q: "elf" }] };
  const fetchMock = vi.fn();

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("searches through Rust when the site answers", async () => {
    api.post.mockResolvedValueOnce({ results: [] });
    await expect(searchJannyWithFallback(body)).resolves.toEqual({ results: [] });
    expect(api.post).toHaveBeenCalledWith("janny/search", { payload: body });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets a forced token and posts to the site itself when the app is blocked", async () => {
    api.post.mockRejectedValueOnce(new ApiError("blocked", 500, { code: "upstream_blocked" }));
    api.get.mockResolvedValueOnce({ token: "fresh-token" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ hits: [] }] }), { status: 200 }));

    await expect(searchJannyWithFallback(body)).resolves.toEqual({ results: [{ hits: [] }] });
    expect(api.get).toHaveBeenCalledWith("janny/token?force=true");
    expect(fetchMock).toHaveBeenCalledWith("https://search.jannyai.com/multi-search", {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Authorization: "Bearer fresh-token",
        "x-meilisearch-client": "Meilisearch instant-meilisearch (v0.19.0) ; Meilisearch JavaScript (v0.41.0)",
      },
      body: JSON.stringify(body),
    });
  });

  it("also falls back when the error mentions Cloudflare in any case", async () => {
    api.post.mockRejectedValueOnce(new Error("Blocked by CLOUDFLARE"));
    api.get.mockResolvedValueOnce({ token: "t" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await searchJannyWithFallback(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry other failures", async () => {
    const failure = new ApiError("Upstream returned 500", 500, { code: "upstream_request_failed" });
    api.post.mockRejectedValueOnce(failure);
    await expect(searchJannyWithFallback(body)).rejects.toBe(failure);
    expect(api.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when there is no token or the site refuses", async () => {
    api.post.mockRejectedValue(new ApiError("blocked", 500, { code: "upstream_blocked" }));
    api.get.mockResolvedValueOnce({ token: "" });
    await expect(searchJannyWithFallback(body)).rejects.toThrow("JannyAI search token is unavailable");

    api.get.mockResolvedValueOnce({ token: "t" });
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(searchJannyWithFallback(body)).rejects.toThrow("JannyAI browser fallback returned 403");
  });
});

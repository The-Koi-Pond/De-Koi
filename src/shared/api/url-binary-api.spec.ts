import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  target: null as null | { baseUrl: string; authorization?: string },
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({ invokeTauri: runtime.invokeTauri }));
vi.mock("./remote-runtime", () => ({
  remoteRuntimeTarget: () => runtime.target,
  remoteHeaders: (target: { authorization?: string }) => ({
    ...(target.authorization ? { Authorization: target.authorization } : {}),
    "X-Marinara-CSRF": "1",
  }),
}));

import { urlBinaryApi } from "./url-binary-api";

describe("urlBinaryApi.load", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    runtime.target = null;
    runtime.invokeTauri.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the remote runtime's own asset URLs in the browser instead of through the server fetch", async () => {
    runtime.target = { baseUrl: "http://pi:7860", authorization: "Basic abc" };
    fetchMock.mockResolvedValue(new Response(new Blob(["ogg-bytes"], { type: "audio/ogg" })));

    const blob = await urlBinaryApi.load("http://pi:7860/api/assets/game/ambient/nature/howling-wind.ogg");

    expect(fetchMock).toHaveBeenCalledWith("http://pi:7860/api/assets/game/ambient/nature/howling-wind.ogg", {
      method: "GET",
      headers: { Authorization: "Basic abc", "X-Marinara-CSRF": "1" },
    });
    expect(runtime.invokeTauri).not.toHaveBeenCalled();
    expect(blob.type).toBe("audio/ogg");
    expect(await blob.text()).toBe("ogg-bytes");
  });

  it("surfaces a failed runtime asset load", async () => {
    runtime.target = { baseUrl: "http://pi:7860" };
    fetchMock.mockResolvedValue(new Response("missing", { status: 404 }));

    await expect(urlBinaryApi.load("http://pi:7860/api/assets/game/music/gone.mp3")).rejects.toThrow("404");
    expect(runtime.invokeTauri).not.toHaveBeenCalled();
  });

  it("keeps other hosts, other runtime routes and the embedded app on load_url_binary", async () => {
    runtime.invokeTauri.mockResolvedValue({ base64: btoa("png"), mimeType: "image/png" });

    runtime.target = { baseUrl: "http://pi:7860" };
    await urlBinaryApi.load("https://cdn.example.com/api/assets/game/x.png");
    await urlBinaryApi.load("http://pi:7860/api/invoke");
    runtime.target = null;
    await urlBinaryApi.load("http://pi:7860/api/assets/game/x.png");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.invokeTauri).toHaveBeenCalledTimes(3);
  });
});

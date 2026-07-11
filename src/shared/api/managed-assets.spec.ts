import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeTarget = { baseUrl: string; authorization?: string };

const remoteRuntimeMock = vi.hoisted(() => ({
  target: null as RuntimeTarget | null,
  remoteHeaders: vi.fn((target: RuntimeTarget) => ({
    ...(target.authorization ? { Authorization: target.authorization } : {}),
    "X-Marinara-CSRF": "1",
  })),
  remoteRuntimeTarget: vi.fn(() => remoteRuntimeMock.target),
}));
const tauriClientMock = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./remote-runtime", () => ({
  remoteHeaders: remoteRuntimeMock.remoteHeaders,
  remoteRuntimeTarget: remoteRuntimeMock.remoteRuntimeTarget,
}));
vi.mock("./tauri-client", () => ({
  invokeTauri: tauriClientMock.invokeTauri,
}));

import { gameAssetUrl, remoteManagedAssetPath, userBackgroundUrl } from "./managed-asset-paths";
import { resolveGalleryFileUrl } from "./managed-asset-resolvers";
import { managedAssetThumbnailRemotePath } from "./managed-asset-thumbnails";
import {
  invalidateRemoteManagedAssetObjectUrls,
  remoteManagedAssetResolvableUrl,
  remoteManagedAssetUrl,
} from "./remote-managed-assets";

describe("managed asset paths", () => {
  it("normalizes local prefixes without losing encoded path separators", () => {
    expect(userBackgroundUrl("City\\Night Sky.png")).toBe("marinara-background:City%2FNight%20Sky.png");
    expect(gameAssetUrl("maps\\level 1/bg.png")).toBe("marinara-game-asset:maps%2Flevel%201%2Fbg.png");
  });

  it("normalizes remote asset paths by trimming unsafe empty and traversal segments", () => {
    expect(remoteManagedAssetPath(" folder \\ ./ child image.png ")).toBe("folder/child%20image.png");
    expect(remoteManagedAssetPath("one/../two/#final.png")).toBe("one/two/%23final.png");
    expect(remoteManagedAssetPath(" ../. ")).toBeNull();
  });

  it("builds thumbnail source paths without URL encoding the source route", () => {
    expect(managedAssetThumbnailRemotePath("gallery", " folder \\ ./ child image.png ", 256)).toBe(
      "gallery/256/folder/child image.png",
    );
  });
});

describe("managed asset resolvers", () => {
  afterEach(() => {
    tauriClientMock.invokeTauri.mockReset();
    vi.restoreAllMocks();
    remoteRuntimeMock.target = null;
  });

  it("resolves embedded gallery files through a checked filename command", async () => {
    tauriClientMock.invokeTauri.mockResolvedValue({ path: "C:\\De-KoiData\\gallery\\scene.png" });

    await expect(resolveGalleryFileUrl(null, "C:\\outside\\scene.png")).resolves.toBe(
      "C:\\De-KoiData\\gallery\\scene.png",
    );

    expect(tauriClientMock.invokeTauri).toHaveBeenCalledWith("gallery_file_path", { filename: "scene.png" });
  });

  it("does not convert arbitrary absolute gallery paths when the checked path is rejected", async () => {
    tauriClientMock.invokeTauri.mockRejectedValue(new Error("Gallery asset was not found"));

    await expect(resolveGalleryFileUrl(null, "C:\\outside\\secret.png")).rejects.toThrow("Gallery asset was not found");

    expect(tauriClientMock.invokeTauri).toHaveBeenCalledWith("gallery_file_path", { filename: "secret.png" });
  });
});

describe("remote managed assets", () => {
  beforeEach(() => {
    remoteRuntimeMock.target = { baseUrl: "http://127.0.0.1:3080" };
  });

  afterEach(() => {
    invalidateRemoteManagedAssetObjectUrls();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    remoteRuntimeMock.target = null;
  });

  it("constructs unauthenticated remote asset URLs with optional cache busting", () => {
    expect(remoteManagedAssetUrl("game", "maps\\level 1/bg.png", "v=abc")).toBe(
      "http://127.0.0.1:3080/api/assets/game/maps/level%201/bg.png?v=abc",
    );
  });

  it("uses object URLs for authorized remote assets and reuses the blob fetch cache", async () => {
    remoteRuntimeMock.target = { baseUrl: "http://127.0.0.1:3080", authorization: "Basic token" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("asset", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:managed-asset");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });

    await expect(remoteManagedAssetResolvableUrl("avatar", "characters/hero.png")).resolves.toBe("blob:managed-asset");
    await expect(remoteManagedAssetResolvableUrl("avatar", "characters/hero.png")).resolves.toBe("blob:managed-asset");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:3080\/api\/assets\/avatar\/characters\/hero\.png/),
      {
        method: "GET",
        headers: {
          Authorization: "Basic token",
          "X-Marinara-CSRF": "1",
        },
      },
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("evicts and revokes the least recently used authorized asset after 64 entries", async () => {
    remoteRuntimeMock.target = { baseUrl: "http://127.0.0.1:3080", authorization: "Basic token" };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => new Response("asset", { status: 200 })),
    );
    const createObjectURL = vi.fn((_blob: Blob) => `blob:managed-asset-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    for (let index = 0; index < 65; index += 1) {
      await remoteManagedAssetResolvableUrl("gallery", `image-${index}.png`);
    }

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:managed-asset-1");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    await remoteManagedAssetResolvableUrl("gallery", "image-0.png");
    expect(createObjectURL).toHaveBeenCalledTimes(66);
  });

  it("rejects and revokes one authorized blob larger than the byte budget", async () => {
    remoteRuntimeMock.target = { baseUrl: "http://127.0.0.1:3080", authorization: "Basic token" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("asset", { status: 200, headers: { "Content-Length": String(128 * 1024 * 1024 + 1) } }),
        ),
    );
    const createObjectURL = vi.fn(() => "blob:oversized");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    await expect(remoteManagedAssetResolvableUrl("gallery", "oversized.png")).rejects.toThrow(
      "Remote managed asset exceeds the in-memory limit",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:oversized");
  });

  it("adds source invalidation versions to thumbnail routes without changing unrelated assets", () => {
    const beforeThumbnail = remoteManagedAssetUrl("thumbnail", "gallery/256/folder/image.png");
    const beforeGallery = remoteManagedAssetUrl("gallery", "folder/image.png");
    const beforeGame = remoteManagedAssetUrl("game", "folder/image.png");

    invalidateRemoteManagedAssetObjectUrls("gallery", "folder/image.png");

    expect(remoteManagedAssetUrl("thumbnail", "gallery/256/folder/image.png")).not.toBe(beforeThumbnail);
    expect(remoteManagedAssetUrl("gallery", "folder/image.png")).not.toBe(beforeGallery);
    expect(remoteManagedAssetUrl("thumbnail", "gallery/256/folder/image.png")).toMatch(
      /^http:\/\/127\.0\.0\.1:3080\/api\/assets\/thumbnail\/gallery\/256\/folder\/image\.png\?mriAssetV=\d+$/,
    );
    expect(remoteManagedAssetUrl("gallery", "folder/image.png")).toMatch(
      /^http:\/\/127\.0\.0\.1:3080\/api\/assets\/gallery\/folder\/image\.png\?mriAssetV=\d+$/,
    );
    expect(remoteManagedAssetUrl("game", "folder/image.png")).toBe(beforeGame);
  });
});

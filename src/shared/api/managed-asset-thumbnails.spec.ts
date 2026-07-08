import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveManagedAssetThumbnailFileUrl } from "./managed-asset-thumbnails";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  remoteManagedAssetResolvableUrl: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock("./remote-managed-assets", () => ({
  remoteManagedAssetResolvableUrl: mocks.remoteManagedAssetResolvableUrl,
  remoteManagedAssetUrl: vi.fn(() => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("resolveManagedAssetThumbnailFileUrl", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
    mocks.remoteManagedAssetResolvableUrl.mockReset();
    mocks.remoteManagedAssetResolvableUrl.mockResolvedValue(null);
  });

  it("limits concurrent generic thumbnail path resolutions", async () => {
    const first = deferred<{ path: string }>();
    const second = deferred<{ path: string }>();
    const third = deferred<{ path: string }>();
    mocks.invokeTauri
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);

    const resolutions = [
      resolveManagedAssetThumbnailFileUrl("game", "one.png", 256),
      resolveManagedAssetThumbnailFileUrl("game", "two.png", 256),
      resolveManagedAssetThumbnailFileUrl("game", "three.png", 256),
    ];

    await Promise.resolve();

    expect(mocks.invokeTauri).toHaveBeenCalledTimes(2);

    first.resolve({ path: "thumb-one.png" });

    await expect(resolutions[0]).resolves.toBe("thumb-one.png");

    expect(mocks.invokeTauri).toHaveBeenCalledTimes(3);

    second.resolve({ path: "thumb-two.png" });
    third.resolve({ path: "thumb-three.png" });

    await expect(Promise.all(resolutions)).resolves.toEqual(["thumb-one.png", "thumb-two.png", "thumb-three.png"]);
  });
});

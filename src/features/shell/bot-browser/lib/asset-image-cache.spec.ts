import { describe, expect, it, vi } from "vitest";

import { createAssetImageCache } from "./asset-image-cache";

describe("asset image cache", () => {
  it("deduplicates concurrent and repeated resolutions", async () => {
    const cache = createAssetImageCache(4);
    const resolver = vi.fn(async (src: string) => `blob:${src}`);

    const first = cache.resolve("tauri-api:/avatar/one", resolver);
    const second = cache.resolve("tauri-api:/avatar/one", resolver);

    await expect(Promise.all([first, second])).resolves.toEqual([
      "blob:tauri-api:/avatar/one",
      "blob:tauri-api:/avatar/one",
    ]);
    await expect(cache.resolve("tauri-api:/avatar/one", resolver)).resolves.toBe(
      "blob:tauri-api:/avatar/one",
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("drops failed resolutions so retry can fetch again", async () => {
    const cache = createAssetImageCache(4);
    const resolver = vi
      .fn<(src: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("blob:retry");

    await expect(cache.resolve("tauri-api:/avatar/retry", resolver)).rejects.toThrow("temporary");
    await expect(cache.resolve("tauri-api:/avatar/retry", resolver)).resolves.toBe("blob:retry");
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});


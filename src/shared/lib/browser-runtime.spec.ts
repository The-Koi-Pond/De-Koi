import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBrowserRuntimeCaches, forceRefreshSpa, registerPreloadErrorRecovery } from "./browser-runtime";

describe("clearBrowserRuntimeCaches", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("best-effort unregisters service workers and deletes browser caches without clearing app data", async () => {
    const unregisterFirst = vi.fn().mockResolvedValue(true);
    const unregisterSecond = vi.fn().mockRejectedValue(new Error("worker already gone"));
    const deleteCache = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("cache already gone"));
    window.localStorage.setItem("de-koi-settings", "keep-me");

    await expect(
      clearBrowserRuntimeCaches({
        serviceWorker: {
          getRegistrations: vi
            .fn()
            .mockResolvedValue([{ unregister: unregisterFirst }, { unregister: unregisterSecond }]),
        },
        cacheStorage: {
          keys: vi.fn().mockResolvedValue(["old-shell", "old-assets"]),
          delete: deleteCache,
        },
      }),
    ).resolves.toBeUndefined();

    expect(unregisterFirst).toHaveBeenCalledOnce();
    expect(unregisterSecond).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenNthCalledWith(1, "old-shell");
    expect(deleteCache).toHaveBeenNthCalledWith(2, "old-assets");
    expect(window.localStorage.getItem("de-koi-settings")).toBe("keep-me");
  });

  it("tolerates missing or inaccessible browser runtime APIs", async () => {
    await expect(
      clearBrowserRuntimeCaches({
        serviceWorker: null,
        cacheStorage: null,
      }),
    ).resolves.toBeUndefined();

    await expect(
      clearBrowserRuntimeCaches({
        serviceWorker: {
          getRegistrations: vi.fn().mockRejectedValue(new Error("blocked")),
        },
        cacheStorage: {
          keys: vi.fn().mockRejectedValue(new Error("blocked")),
          delete: vi.fn(),
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("forceRefreshSpa", () => {
  it("clears runtime caches and replaces the current URL with a cache buster", async () => {
    const clearCaches = vi.fn().mockResolvedValue(undefined);
    const replaceLocation = vi.fn();

    await forceRefreshSpa({
      currentUrl: "http://pi:7860/chat?character=harlequin#latest",
      queryParamValue: "12345",
      clearCaches,
      replaceLocation,
    });

    expect(clearCaches).toHaveBeenCalledOnce();
    expect(replaceLocation).toHaveBeenCalledWith("http://pi:7860/chat?character=harlequin&spa_refresh=12345#latest");
  });
});

describe("registerPreloadErrorRecovery", () => {
  it("recovers once per cooldown and lets repeated failures surface", () => {
    const eventTarget = new EventTarget();
    const refreshSpa = vi.fn().mockResolvedValue(undefined);
    let now = 10_000;
    window.sessionStorage.clear();

    const unregister = registerPreloadErrorRecovery({
      eventTarget,
      sessionStorage: window.sessionStorage,
      now: () => now,
      refreshSpa,
    });

    const first = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(refreshSpa).toHaveBeenCalledWith({ queryParamKey: "chunk_reload" });

    const repeated = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(false);
    expect(refreshSpa).toHaveBeenCalledTimes(1);

    now += 20_001;
    const afterCooldown = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(afterCooldown);
    expect(afterCooldown.defaultPrevented).toBe(true);
    expect(refreshSpa).toHaveBeenCalledTimes(2);

    unregister();
    now += 20_001;
    eventTarget.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(refreshSpa).toHaveBeenCalledTimes(2);
  });
});

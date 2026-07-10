import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAssetImageCache } from "../lib/asset-image-cache";
import { BotBrowserAssetImage } from "./BotBrowserAssetImage";

describe("BotBrowserAssetImage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let observerCallback: IntersectionObserverCallback;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        readonly root = null;
        readonly rootMargin = "0px";
        readonly thresholds = [0];
      },
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("resolves a lazy proxy asset once when duplicate observer signals arrive", async () => {
    const resolveBlob = vi.fn(async () => new Blob(["avatar"], { type: "image/png" }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:avatar"),
      revokeObjectURL: vi.fn(),
    });

    await act(async () => {
      root.render(
        <BotBrowserAssetImage
          src="tauri-api:/avatar/one"
          alt="One"
          loading="lazy"
          onError={() => {}}
          cache={createAssetImageCache<Blob>(4)}
          resolveBlob={resolveBlob}
        />,
      );
    });
    expect(resolveBlob).not.toHaveBeenCalled();

    await act(async () => {
      const entry = { isIntersecting: true } as IntersectionObserverEntry;
      observerCallback!([entry], {} as IntersectionObserver);
      observerCallback!([entry], {} as IntersectionObserver);
      await Promise.resolve();
    });

    expect(resolveBlob).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:avatar");
  });
});

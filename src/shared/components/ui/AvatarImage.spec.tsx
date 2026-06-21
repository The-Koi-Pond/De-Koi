import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarImage } from "./AvatarImage";

const localFileApi = vi.hoisted(() => ({
  avatarFileUrlFromPath: vi.fn(),
  avatarThumbnailFileUrlFromPath: vi.fn(),
  canGenerateAvatarThumbnail: vi.fn(),
  resolveAvatarFileUrl: vi.fn(),
  resolveAvatarThumbnailFileUrl: vi.fn(),
}));

vi.mock("../../api/local-file-api", () => localFileApi);

type ResizeObserverInstance = {
  callback: ResizeObserverCallback;
  observed: Element[];
  observe: (element: Element) => void;
  disconnect: () => void;
};

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AvatarImage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let resizeObservers: ResizeObserverInstance[] = [];
  let avatarBoxSize = 40;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestIdleCallback: Window["requestIdleCallback"] | undefined;
  let originalCancelIdleCallback: Window["cancelIdleCallback"] | undefined;
  let naturalWidthDescriptor: PropertyDescriptor | undefined;
  let naturalHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localFileApi.avatarFileUrlFromPath.mockReturnValue("asset://full-sync");
    localFileApi.avatarThumbnailFileUrlFromPath.mockReturnValue("asset://thumb-sync");
    localFileApi.canGenerateAvatarThumbnail.mockReturnValue(true);
    localFileApi.resolveAvatarFileUrl.mockResolvedValue("asset://full-async");
    localFileApi.resolveAvatarThumbnailFileUrl.mockResolvedValue("asset://thumb-async");

    originalResizeObserver = window.ResizeObserver;
    originalRequestIdleCallback = window.requestIdleCallback;
    originalCancelIdleCallback = window.cancelIdleCallback;
    naturalWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
    naturalHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalHeight");

    window.requestIdleCallback = ((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 10 });
      return 1;
    }) as Window["requestIdleCallback"];
    window.cancelIdleCallback = vi.fn() as Window["cancelIdleCallback"];
    window.ResizeObserver = class {
      private readonly instance: ResizeObserverInstance;

      constructor(callback: ResizeObserverCallback) {
        this.instance = {
          callback,
          observed: [],
          observe: (element) => {
            this.instance.observed.push(element);
          },
          disconnect: () => {
            this.instance.observed = [];
          },
        };
        resizeObservers.push(this.instance);
      }

      observe(element: Element) {
        this.instance.observe(element);
      }

      unobserve(element: Element) {
        this.instance.observed = this.instance.observed.filter((target) => target !== element);
      }

      disconnect() {
        this.instance.disconnect();
      }
    };

    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 600 });

    avatarBoxSize = 40;
    resizeObservers = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
      this: HTMLElement,
    ) {
      const size = this instanceof HTMLImageElement ? 1 : avatarBoxSize;
      return {
        x: 0,
        y: 0,
        width: size,
        height: size,
        top: 0,
        right: size,
        bottom: size,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    if (originalResizeObserver) {
      window.ResizeObserver = originalResizeObserver;
    } else {
      delete (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
    if (originalRequestIdleCallback) {
      window.requestIdleCallback = originalRequestIdleCallback;
    } else {
      delete (window as unknown as { requestIdleCallback?: Window["requestIdleCallback"] }).requestIdleCallback;
    }
    if (originalCancelIdleCallback) {
      window.cancelIdleCallback = originalCancelIdleCallback;
    } else {
      delete (window as unknown as { cancelIdleCallback?: Window["cancelIdleCallback"] }).cancelIdleCallback;
    }
    if (naturalWidthDescriptor) {
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", naturalWidthDescriptor);
    }
    if (naturalHeightDescriptor) {
      Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", naturalHeightDescriptor);
    }
    vi.restoreAllMocks();
  });

  it("keeps successful thumbnail renders on the thumbnail source unless full resolution is requested", async () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <AvatarImage
          src="C:\\avatars\\makima.png"
          avatarFilePath="C:\\avatars\\makima.png"
          avatarFilename="makima.png"
          alt="Makima"
          thumbnailSize={64}
        />,
      );
    });

    await flushAsyncWork();

    expect(localFileApi.resolveAvatarThumbnailFileUrl).toHaveBeenCalledTimes(1);
    expect(localFileApi.resolveAvatarFileUrl).not.toHaveBeenCalled();
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("asset://thumb-async");
  });

  it("uses the full-resolution source when thumbnail renders explicitly request it", async () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <AvatarImage
          src="C:\\avatars\\deki.png"
          avatarFilePath="C:\\avatars\\deki.png"
          avatarFilename="deki.png"
          alt="Deki"
          thumbnailSize={64}
          upgradeToFullResolution
        />,
      );
    });

    await flushAsyncWork();

    expect(localFileApi.resolveAvatarThumbnailFileUrl).not.toHaveBeenCalled();
    expect(localFileApi.resolveAvatarFileUrl).not.toHaveBeenCalled();
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("asset://full-sync");
  });

  it("negative-caches failed managed avatar resolution across remounts", async () => {
    localFileApi.resolveAvatarThumbnailFileUrl.mockResolvedValue(null);
    localFileApi.resolveAvatarFileUrl.mockResolvedValue(null);

    act(() => {
      root = createRoot(container!);
      root.render(
        <AvatarImage
          src="C:\\avatars\\missing.png"
          avatarFilePath="C:\\avatars\\missing.png"
          avatarFilename="missing.png"
          alt="Missing"
          thumbnailSize={64}
        />,
      );
    });
    await flushAsyncWork();
    act(() => {
      root?.unmount();
    });
    root = null;

    act(() => {
      root = createRoot(container!);
      root.render(
        <AvatarImage
          src="C:\\avatars\\missing.png"
          avatarFilePath="C:\\avatars\\missing.png"
          avatarFilename="missing.png"
          alt="Missing"
          thumbnailSize={64}
        />,
      );
    });
    await flushAsyncWork();

    expect(localFileApi.resolveAvatarThumbnailFileUrl).toHaveBeenCalledTimes(1);
    expect(localFileApi.resolveAvatarFileUrl).toHaveBeenCalledTimes(1);
  });

  it("recomputes source-rect crop geometry after observed layout changes", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <AvatarImage
          src="data:image/png;base64,avatar"
          alt="Cropped"
          crop={{ srcX: 0, srcY: 0, srcWidth: 0.5, srcHeight: 0.5 }}
        />,
      );
    });

    const img = container!.querySelector("img")!;
    expect(img.style.width).toBe("80px");
    expect(resizeObservers.some((observer) => observer.observed.includes(img))).toBe(true);

    avatarBoxSize = 80;
    act(() => {
      for (const observer of resizeObservers) {
        observer.callback([], observer as unknown as ResizeObserver);
      }
    });

    expect(img.style.width).toBe("160px");
  });
});

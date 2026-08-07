import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageAttachmentImagePreview } from "./MessageAttachmentImagePreview";

const localFileApi = vi.hoisted(() => ({
  resolveGalleryFileUrl: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../../../../../shared/api/local-file-api", () => localFileApi);

describe("MessageAttachmentImagePreview", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localFileApi.resolveGalleryFileUrl.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("keeps an inline clipboard image instead of resolving a reused filename", async () => {
    const currentImage = "data:image/png;base64,current-image";
    localFileApi.resolveGalleryFileUrl.mockResolvedValue("blob:week-old-image");

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <MessageAttachmentImagePreview
          attachment={{
            type: "image/png",
            data: currentImage,
            filename: "image.png",
            name: "image.png",
          }}
          onOpen={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(container!.querySelector("img")?.getAttribute("src")).toBe(currentImage);
    expect(localFileApi.resolveGalleryFileUrl).not.toHaveBeenCalled();
  });

  it("still resolves an attachment that explicitly belongs to the managed gallery", async () => {
    localFileApi.resolveGalleryFileUrl.mockResolvedValue("blob:managed-image");

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <MessageAttachmentImagePreview
          attachment={{
            type: "image/png",
            filename: "managed-image.png",
            galleryId: "gallery-image-1",
          }}
          onOpen={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(localFileApi.resolveGalleryFileUrl).toHaveBeenCalledWith("managed-image.png", null);
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("blob:managed-image");
  });
});

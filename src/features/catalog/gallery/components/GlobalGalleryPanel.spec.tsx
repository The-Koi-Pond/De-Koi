import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const images = Array.from({ length: 100 }, (_, index) => ({
  id: `image-${index}`,
  folderId: null,
  filePath: `image-${index}.png`,
  filename: `image-${index}.png`,
  prompt: "",
  provider: "test",
  model: "test",
  width: 256,
  height: 256,
  createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
  url: `image-${index}.png`,
}));
const mutation = { mutate: vi.fn(), isPending: false };

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 9000,
    getVirtualItems: () => [0, 1, 2].map((index) => ({ key: index, index, start: index * 180 })),
    measureElement: vi.fn(),
  }),
}));
vi.mock("../hooks/use-global-gallery", () => ({
  useGlobalGalleryImages: () => ({ data: images, isLoading: false, hasNextPage: false, fetchNextPage: vi.fn() }),
  useGalleryFolders: () => ({ data: [] }),
  useUploadGlobalGalleryImages: () => mutation,
  useDeleteGlobalGalleryImage: () => mutation,
  useMoveGlobalGalleryImage: () => mutation,
  useTagGlobalGalleryImage: () => mutation,
  useCreateGalleryFolder: () => mutation,
  useRenameGalleryFolder: () => mutation,
  useDeleteGalleryFolder: () => mutation,
}));
vi.mock("../../../../shared/api/local-file-api", () => ({
  galleryThumbnailPath: (_filename: string, path: string) => path,
  resolveGalleryFileUrl: vi.fn(async () => null),
  resolveManagedAssetThumbnailFileUrl: vi.fn(async () => null),
}));

import { GlobalGalleryPanel } from "./GlobalGalleryPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GlobalGalleryPanel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("mounts only cards belonging to virtual rows for a large gallery", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalGalleryPanel />);
    });

    expect(container.querySelectorAll('[title="Drag onto a folder to move it"]')).toHaveLength(6);
  });
});

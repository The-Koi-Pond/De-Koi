import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolveThumbnail: vi.fn(async (_kind: string, path: string) => `thumb:${path}`),
}));

vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: { list: mocks.list } }));
vi.mock("../../../../shared/api/local-file-api", () => ({
  galleryThumbnailPath: (_filename: string | null | undefined, path: string) => path,
  resolveManagedAssetThumbnailFileUrl: mocks.resolveThumbnail,
}));

import { fetchGlobalGalleryPage, GLOBAL_GALLERY_PAGE_SIZE } from "./use-global-gallery";

function image(id: string, createdAt: string) {
  return { id, createdAt, filePath: `${id}.png`, filename: `${id}.png`, folderId: null, url: "" };
}

describe("global gallery pagination", () => {
  beforeEach(() => mocks.list.mockReset());

  it("loads stable 48-row pages using the prior last createdAt and id as the cursor", async () => {
    const firstPage = Array.from({ length: GLOBAL_GALLERY_PAGE_SIZE }, (_, index) =>
      image(`image-${index}`, `2026-07-11T00:00:${String(59 - index).padStart(2, "0")}Z`),
    );
    mocks.list.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([image("older", "2026-07-10T00:00:00Z")]);

    const first = await fetchGlobalGalleryPage();
    expect(mocks.list).toHaveBeenNthCalledWith(
      1,
      "global-gallery",
      expect.objectContaining({ limit: GLOBAL_GALLERY_PAGE_SIZE, orderBy: "createdAt", descending: true }),
    );
    expect(first.nextCursor).toBe("2026-07-11T00:00:12Z|image-47");

    await fetchGlobalGalleryPage(first.nextCursor);
    expect(mocks.list).toHaveBeenNthCalledWith(
      2,
      "global-gallery",
      expect.objectContaining({ before: "2026-07-11T00:00:12Z|image-47" }),
    );
  });
});

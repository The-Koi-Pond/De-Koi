import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGallery } from "./fake-gallery-storage";
import { GalleryHarness, type Recording } from "./gallery-replay-harness";
import showJson from "./test-fixtures/recorded-show.json";

const virtualizer = vi.hoisted(() => ({ real: false }));

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storageApi: (await import("./fake-gallery-storage")).fakeStorageApi,
}));
vi.mock("../../../../../shared/api/image-generation-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  galleryApi: (await import("./fake-gallery-storage")).fakeGalleryApi,
}));
vi.mock("../../../../../shared/api/local-file-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("./fake-gallery-storage")).fakeFileUrls,
}));
vi.mock("../../../../../shared/lib/app-dialogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showConfirmDialog: (await import("./fake-gallery-storage")).fakeConfirmDialog,
  showPromptDialog: (await import("./fake-gallery-storage")).fakePromptDialog,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (await import("./fake-gallery-storage")).fakeToast,
}));
vi.mock("../../../../../shared/components/ui/CustomEmojiTagButton", async () => ({
  CustomEmojiTagButton: (await import("./fake-gallery-storage")).FakeTagButton,
}));
// The recorder's stand-in, or (for one test) the real virtualizer.
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  const { fakeUseVirtualizer } = await import("./fake-gallery-storage");
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      virtualizer.real ? actual.useVirtualizer(options) : fakeUseVirtualizer(options),
  };
});

const recording = showJson as unknown as Recording;

let harness: GalleryHarness | null = null;

afterEach(async () => {
  await harness?.unmount();
  harness = null;
  virtualizer.real = false;
});

async function open(images: Recording["images"] | "IMAGES" = "IMAGES") {
  harness = new GalleryHarness(recording, { images, folders: "FOLDERS" });
  await harness.mount();
  harness.takeCalls();
  return harness;
}

/** 100 plain unfiled images, two loaded pages and a third. */
function hundredImages() {
  return Array.from({ length: 100 }, (_, index) => {
    const id = `v-${String(index).padStart(3, "0")}`;
    const day = String((index % 28) + 1).padStart(2, "0");
    return {
      id,
      folderId: null,
      filePath: `/data/gallery/${id}.png`,
      filename: `${id}.png`,
      prompt: "",
      provider: "upload",
      model: "",
      width: 64,
      height: 64,
      createdAt: `2026-01-${day}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      url: `/api/gallery/file/${id}.png`,
    };
  });
}

function cards(panel: GalleryHarness) {
  return panel.element.querySelectorAll('[draggable="true"]');
}

function dialog(panel: GalleryHarness) {
  return panel.element.querySelector<HTMLElement>('[role="dialog"]');
}

function focusName() {
  const active = document.activeElement;
  return active
    ? `${active.tagName.toLowerCase()}:${active.getAttribute("title") ?? active.getAttribute("aria-label") ?? ""}`
    : null;
}

describe("the grid is virtualized by rows of two", () => {
  it("mounts only the rows the virtualizer reports", async () => {
    const panel = await open(hundredImages());
    await panel.click(panel.button("Load older images"));
    await panel.click(panel.button("Load older images"));
    expect(panel.element.textContent).toContain("100 images");
    expect(fakeGallery.virtualizerOptions).toMatchObject({ count: 50, overscan: 2 });
    const { estimateSize } = fakeGallery.virtualizerOptions as { estimateSize: (index: number) => number };
    expect(estimateSize(0)).toBe(180);

    fakeGallery.showRows(3);
    await panel.click(panel.chip("Unfiled"));
    expect(cards(panel)).toHaveLength(6);
    expect(panel.element.querySelectorAll("img")).toHaveLength(6);
  });

  it("keeps a large library to a few mounted rows with the real virtualizer", async () => {
    virtualizer.real = true;
    // jsdom lays nothing out: the scroll box is 400px tall and each row 180px, the estimate.
    const sizes = [
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("overflow-y-auto") ? 400 : 0;
      }),
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180),
    ];
    try {
      const panel = await open(hundredImages());
      await panel.click(panel.button("Load older images"));
      await panel.click(panel.button("Load older images"));
      expect(panel.element.textContent).toContain("100 images");
      // Rows 0 to 2 are in view, plus two rows of overscan: five rows of two.
      expect(cards(panel)).toHaveLength(10);
    } finally {
      for (const size of sizes) size.mockRestore();
    }
  });
});

describe("lightbox keyboard", () => {
  it("moves focus to Close when it opens and back to the card when it closes", async () => {
    const panel = await open();
    const opener = panel.card("img-2").querySelector("button")!;
    act(() => opener.focus());
    await panel.click(opener);
    expect(focusName()).toBe("button:Close");

    await panel.click(panel.buttonNamed("Close"));
    expect(dialog(panel)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus after Escape and after the backdrop too", async () => {
    const panel = await open();
    const opener = panel.card("img-1").querySelector("button")!;
    act(() => opener.focus());
    await panel.click(opener);
    await panel.key("Escape");
    expect(document.activeElement).toBe(opener);

    await panel.click(opener);
    await panel.click(dialog(panel)!);
    expect(dialog(panel)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("cycles Tab and Shift+Tab inside the dialog", async () => {
    const panel = await open();
    await panel.click(panel.card("img-1").querySelector("button")!);
    const focusable = [...dialog(panel)!.querySelectorAll<HTMLElement>("select, a, button")];
    expect(focusable.map((element) => element.getAttribute("aria-label") ?? element.getAttribute("title"))).toEqual([
      "Move image to folder",
      "Download",
      "Delete",
      "Close",
    ]);

    await panel.key("Tab");
    expect(focusName()).toBe("select:Move image to folder");
    await panel.key("Tab", true);
    expect(focusName()).toBe("button:Close");

    // Focus that slipped outside the dialog comes back in.
    act(() => panel.outside.focus());
    await panel.key("Tab");
    expect(focusName()).toBe("select:Move image to folder");
    act(() => panel.outside.focus());
    await panel.key("Tab", true);
    expect(focusName()).toBe("button:Close");
  });

  it("skips the folder dropdown while a move runs", async () => {
    const panel = await open();
    await panel.click(panel.card("img-2").querySelector("button")!);
    fakeGallery.hold("update");
    await panel.choose(panel.select("Move image to folder"), "f-3");
    expect(panel.select("Move image to folder").disabled).toBe(true);

    act(() => dialog(panel)!.querySelector<HTMLElement>('a[title="Download"]')!.focus());
    await panel.key("Tab", true);
    expect(focusName()).toBe("button:Close");
    await panel.key("Tab");
    expect(focusName()).toBe("a:Download");
    await panel.release("update");
  });
});

describe("moving from the lightbox", () => {
  it("shows the choice at once and puts it back when the save fails", async () => {
    const panel = await open();
    await panel.click(panel.card("img-2").querySelector("button")!);
    fakeGallery.hold("update");
    fakeGallery.fail("update", "nope");
    await panel.choose(panel.select("Move image to folder"), "f-1");
    expect(panel.select("Move image to folder").value).toBe("f-1");

    await panel.release("update");
    expect(panel.select("Move image to folder").value).toBe("");
    expect(panel.takeCalls()).toEqual([
      ["update", "global-gallery", "img-2", { folderId: "f-1" }],
      ["toast", "error", "Couldn't move this image. Putting it back."],
    ]);
  });

  it("never undoes a newer choice when an earlier save fails", async () => {
    const panel = await open();
    await panel.click(panel.card("img-2").querySelector("button")!);
    fakeGallery.hold("update");
    fakeGallery.fail("update", "nope");
    await panel.choose(panel.select("Move image to folder"), "f-1");
    // A second choice lands while the first save still runs (the dropdown is disabled in the UI, so this
    // reaches the change handler directly).
    await panel.choose(panel.select("Move image to folder"), "f-3");

    await panel.release("update");
    expect(panel.takeCalls()).toEqual([
      ["update", "global-gallery", "img-2", { folderId: "f-1" }],
      ["update", "global-gallery", "img-2", { folderId: "f-3" }],
      ["list", "global-gallery", { orderBy: "createdAt", descending: true, limit: 48 }],
      ["toast", "error", "Couldn't move this image. Putting it back."],
    ]);
    expect(panel.select("Move image to folder").value).toBe("f-3");
    expect(fakeGallery.images.find((image) => image.id === "img-2")!.folderId).toBe("f-3");
  });

  it("leaves another image's dropdown alone when the failed move's lightbox has closed", async () => {
    const panel = await open();
    await panel.click(panel.card("img-2").querySelector("button")!);
    fakeGallery.hold("update");
    fakeGallery.fail("update", "nope");
    await panel.choose(panel.select("Move image to folder"), "f-1");
    await panel.click(panel.buttonNamed("Close"));
    await panel.click(panel.card("img-3").querySelector("button")!);

    await panel.release("update");
    expect(dialog(panel)!.getAttribute("aria-label")).toBe("a cat in a hat");
    expect(panel.select("Move image to folder").value).toBe("");
    expect(panel.takeCalls().at(-1)).toEqual(["toast", "error", "Couldn't move this image. Putting it back."]);
  });

  it("a newer move after a failed one saves normally", async () => {
    const panel = await open();
    await panel.click(panel.card("img-2").querySelector("button")!);
    fakeGallery.fail("update", "nope");
    await panel.choose(panel.select("Move image to folder"), "f-1");
    expect(panel.select("Move image to folder").value).toBe("");
    panel.takeCalls();

    await panel.choose(panel.select("Move image to folder"), "f-3");
    expect(panel.select("Move image to folder").value).toBe("f-3");
    expect(panel.takeCalls()).toEqual([
      ["update", "global-gallery", "img-2", { folderId: "f-3" }],
      ["list", "global-gallery", { orderBy: "createdAt", descending: true, limit: 48 }],
    ]);
  });
});

import { onlineManager } from "@tanstack/react-query";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscapeOverlay } from "../../../../../shared/hooks/use-escape-overlay";
import { fakeGallery } from "./fake-gallery-storage";
import { GalleryHarness, type Recording } from "./gallery-replay-harness";
import { GlobalGalleryPanel } from "./GlobalGalleryPanel";
import showJson from "./test-fixtures/recorded-show.json";

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
vi.mock("@tanstack/react-virtual", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVirtualizer: (await import("./fake-gallery-storage")).fakeUseVirtualizer,
}));

// Starting data: the recorded six images (img-1 and img-5 in Reactions, img-4 in the long-named folder, the
// rest unfiled) and four folders (oldest first: the long-named one, Reactions, Empty, and one with no name).
const recording = showJson as unknown as Recording;
const LONG = "A very long folder name that keeps going";

let harness: GalleryHarness | null = null;

async function open(before: (() => void) | null = null) {
  harness = new GalleryHarness(recording, { images: "IMAGES", folders: "FOLDERS" });
  before?.();
  await harness.mount();
  harness.takeCalls();
  return harness;
}

afterEach(async () => {
  act(() => onlineManager.setOnline(true));
  await harness?.unmount();
  harness = null;
});

function text(panel: GalleryHarness) {
  return panel.element.textContent ?? "";
}

function pressedChips(panel: GalleryHarness) {
  return [...panel.element.querySelectorAll("button[aria-pressed]")].map((chip) => [
    chip.querySelector("span")?.textContent,
    chip.getAttribute("aria-pressed"),
  ]);
}

function writes(calls: readonly unknown[][]) {
  return calls.filter((call) => ["create", "update", "delete", "upload"].includes(call[0] as string));
}

describe("Decision 1: the chips say which one is selected", () => {
  it("marks All, Unfiled and each folder chip pressed or not, following the selection", async () => {
    const panel = await open();
    expect(pressedChips(panel)).toEqual([
      ["All", "true"],
      ["Unfiled", "false"],
      [LONG, "false"],
      ["Reactions", "false"],
      ["Empty", "false"],
      ["", "false"],
    ]);

    await panel.click(panel.chip("Reactions"));
    expect(pressedChips(panel).filter(([, pressed]) => pressed === "true")).toEqual([["Reactions", "true"]]);

    await panel.click(panel.chip("Unfiled"));
    expect(pressedChips(panel).filter(([, pressed]) => pressed === "true")).toEqual([["Unfiled", "true"]]);
  });

  it("leaves the New button without a pressed state", async () => {
    const panel = await open();
    expect(panel.buttonNamed("New folder").hasAttribute("aria-pressed")).toBe(false);
  });
});

describe("Decision 2: a card's Download and Delete show while the card has keyboard focus", () => {
  it("shows the strip on desktop on hover and on keyboard focus inside the card, and always on phones", async () => {
    const panel = await open();
    const strip = panel.card("img-1").querySelector('button[title="Delete"]')!.parentElement!;
    expect(strip.querySelector('a[title="Download"]')).not.toBeNull();
    const classes = [...strip.classList];
    // Hidden only from the md breakpoint up, so phones always see it.
    expect(classes).toContain("md:opacity-0");
    expect(classes.filter((name) => !name.startsWith("md:")).some((name) => name.startsWith("opacity-"))).toBe(false);
    expect(classes).toContain("md:group-hover:opacity-100");
    expect(classes).toContain("md:group-has-[:focus-visible]:opacity-100");
    expect(panel.card("img-1").classList).toContain("group");
  });
});

describe("Decision 3: a gallery that fails to load says so", () => {
  const failFirstPage = () => fakeGallery.fail("list:global-gallery", "offline");

  it("shows the error box with Retry in place of the empty box; count, chips and upload stay", async () => {
    const panel = await open(failFirstPage);
    const shown = text(panel);
    expect(shown).toContain("Couldn't load the gallery.");
    expect(panel.button("Retry")).toBeDefined();
    expect(shown).not.toContain("No images yet");
    expect(panel.element.querySelectorAll(".shimmer")).toHaveLength(0);
    expect(shown.startsWith("0 images")).toBe(true);
    expect(pressedChips(panel).map(([label]) => label)).toEqual(["All", "Unfiled", LONG, "Reactions", "Empty", ""]);
    const upload = panel.buttonNamed("Upload Images");
    expect(upload.getAttribute("aria-disabled")).toBe("false");
    // The error box sits where the grid would be: after the upload button.
    expect(panel.buttons().indexOf(panel.button("Retry"))).toBe(panel.buttons().indexOf(upload) + 1);
    expect(writes(fakeGallery.calls)).toEqual([]);
  });

  it("Retry loads the gallery again, with the loading tiles while it runs, and writes nothing", async () => {
    const panel = await open(failFirstPage);
    fakeGallery.hold("list:global-gallery");
    await panel.click(panel.button("Retry"));
    expect(panel.takeCalls()).toEqual([
      ["list", "global-gallery", { orderBy: "createdAt", descending: true, limit: 48 }],
    ]);
    expect(panel.element.querySelectorAll(".shimmer")).toHaveLength(4);
    expect(text(panel)).not.toContain("Couldn't load the gallery.");

    await panel.release("list:global-gallery");
    expect(text(panel).startsWith("6 images")).toBe(true);
    expect(text(panel)).not.toContain("Couldn't load the gallery.");
    expect(panel.element.querySelectorAll('[draggable="true"]')).toHaveLength(6);
    expect(writes(fakeGallery.calls)).toEqual([]);
  });

  it("shows the error box when the first load is paused offline, and Retry loads it once back online", async () => {
    onlineManager.setOnline(false);
    const panel = await open();
    expect(fakeGallery.calls.filter((call) => call[1] === "global-gallery")).toEqual([]);
    expect(text(panel)).toContain("Couldn't load the gallery.");
    expect(panel.element.querySelectorAll(".shimmer")).toHaveLength(0);
    expect(text(panel).startsWith("0 images")).toBe(true);

    // Still offline: the retry pauses again and the box stays.
    await panel.click(panel.button("Retry"));
    expect(text(panel)).toContain("Couldn't load the gallery.");

    act(() => onlineManager.setOnline(true));
    await panel.click(panel.button("Retry"));
    expect(text(panel).startsWith("6 images")).toBe(true);
    expect(text(panel)).not.toContain("Couldn't load the gallery.");
    expect(writes(fakeGallery.calls)).toEqual([]);
  });

  it("keeps the error box when Retry fails too", async () => {
    const panel = await open(failFirstPage);
    fakeGallery.fail("list:global-gallery", "still offline");
    await panel.click(panel.button("Retry"));
    expect(text(panel)).toContain("Couldn't load the gallery.");
    expect(panel.button("Retry")).toBeDefined();
  });

  it("shows no error box when the library loads, even if it is empty", async () => {
    harness = new GalleryHarness(recording, { images: [], folders: [] });
    await harness.mount();
    expect(text(harness)).toContain("No images yet");
    expect(text(harness)).not.toContain("Couldn't load the gallery.");
  });
});

/** The right panel registers its Escape handler before the gallery mounts, as `RightPanel` does. */
function PanelHost() {
  const [open, setOpen] = useState(true);
  useEscapeOverlay(() => {
    setOpen(false);
    return true;
  }, open);
  return open ? <GlobalGalleryPanel /> : <p>panel closed</p>;
}

describe("Decision 4: Escape in the lightbox closes only the lightbox", () => {
  it("closes the lightbox and leaves the panel open; the next Escape closes the panel", async () => {
    harness = new GalleryHarness(recording, { images: "IMAGES", folders: "FOLDERS" });
    await harness.mount(<PanelHost />);
    await harness.click(harness.card("img-1").querySelector("button")!);
    expect(harness.element.querySelector('[role="dialog"]')).not.toBeNull();

    await harness.key("Escape");
    expect(harness.element.querySelector('[role="dialog"]')).toBeNull();
    expect(text(harness)).not.toContain("panel closed");
    expect(text(harness).startsWith("6 images")).toBe(true);

    await harness.key("Escape");
    expect(text(harness)).toBe("panel closed");
  });
});

describe("Decision 5: a new folder is selected once the folder list has it", () => {
  it("waits for a late folder list, then selects the new folder", async () => {
    const panel = await open();
    fakeGallery.hold("list:gallery-folders");
    fakeGallery.answer("  Memes ");
    await panel.click(panel.buttonNamed("New folder"));
    expect(panel.takeCalls()).toEqual([
      [
        "prompt",
        {
          title: "New Folder",
          message: "Name this gallery folder.",
          placeholder: "e.g. Reactions",
          confirmLabel: "Create",
        },
      ],
      ["create", "gallery-folders", { name: "Memes" }],
      ["list", "gallery-folders", null],
    ]);
    // Created, but the list hasn't answered: All stays selected.
    expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual(["All", "true"]);
    expect(panel.buttonNamed("Upload Images")).toBeDefined();

    await panel.release("list:gallery-folders");
    expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual(["Memes", "true"]);
    expect(panel.buttonNamed('Upload to "Memes"')).toBeDefined();
    expect(panel.buttonNamed("Rename folder")).toBeDefined();
    expect(text(panel)).toContain("No images here");
  });

  it("uploads into the new folder once it is selected", async () => {
    const panel = await open();
    fakeGallery.hold("list:gallery-folders");
    fakeGallery.answer("Memes");
    await panel.click(panel.buttonNamed("New folder"));
    await panel.release("list:gallery-folders");
    panel.takeCalls();
    await panel.upload([["m.png", "image/png"]]);
    expect(panel.takeCalls()[0]).toEqual(["upload", "m.png", "new-folder-1"]);
  });

  it.each(["Unfiled", "Reactions", "All"])(
    "keeps a chip the user picks (%s) while the folder list is still loading",
    async (label) => {
      const panel = await open();
      fakeGallery.hold("list:gallery-folders");
      fakeGallery.answer("Memes");
      await panel.click(panel.buttonNamed("New folder"));
      await panel.click(panel.chip(label));
      expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual([label, "true"]);

      await panel.release("list:gallery-folders");
      // The new folder's chip arrives, but the manual pick stays selected.
      expect(pressedChips(panel).map(([chip]) => chip)).toContain("Memes");
      expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual([label, "true"]);
      expect(panel.buttons().some((button) => button.getAttribute("aria-label") === 'Upload to "Memes"')).toBe(false);
    },
  );

  it("keeps a chip picked while the create itself is still running", async () => {
    const panel = await open();
    fakeGallery.hold("create");
    fakeGallery.answer("Memes");
    await panel.click(panel.buttonNamed("New folder"));
    await panel.click(panel.chip("Unfiled"));

    await panel.release("create");
    expect(pressedChips(panel).map(([chip]) => chip)).toContain("Memes");
    expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual(["Unfiled", "true"]);
    expect(panel.buttons().some((button) => button.getAttribute("aria-label") === 'Upload to "Memes"')).toBe(false);
  });

  it("selects nothing new when the create fails", async () => {
    const panel = await open();
    fakeGallery.answer("Memes");
    fakeGallery.fail("create", "nope");
    await panel.click(panel.buttonNamed("New folder"));
    expect(pressedChips(panel).find(([, pressed]) => pressed === "true")).toEqual(["All", "true"]);
    expect(panel.takeCalls().at(-1)).toEqual(["toast", "error", "Couldn't create the folder. Try again."]);
  });
});

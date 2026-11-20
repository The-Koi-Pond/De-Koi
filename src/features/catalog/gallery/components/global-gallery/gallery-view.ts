// What the panel shows, worked out from the loaded images and folders: the chip filter, the sort, the
// counts and the labels. No React here, so the rules can be tested on their own.
import type { GalleryFolder, GlobalGalleryImage } from "../../hooks/use-global-gallery";

/** The selected chip. Folder ids are free text, so the two fixed chips are kinds, not ids. */
export type GalleryFilter = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; folderId: string };

export const ALL_IMAGES: GalleryFilter = { kind: "all" };
export const UNFILED: GalleryFilter = { kind: "unfiled" };

export function folderFilter(folderId: string): GalleryFilter {
  return { kind: "folder", folderId };
}

export function sameFilter(a: GalleryFilter, b: GalleryFilter): boolean {
  if (a.kind === "folder" || b.kind === "folder") {
    return a.kind === "folder" && b.kind === "folder" && a.folderId === b.folderId;
  }
  return a.kind === b.kind;
}

/** The folder a move to this chip files the image into (`null` is Unfiled). All isn't a target. */
export function moveTargetOf(filter: GalleryFilter): string | null {
  return filter.kind === "folder" ? filter.folderId : null;
}

export type GallerySort = "newest" | "oldest" | "name-asc" | "name-desc";

export const SORT_OPTIONS: ReadonlyArray<{ value: GallerySort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name A → Z" },
  { value: "name-desc", label: "Name Z → A" },
];

export function isGallerySort(value: string): value is GallerySort {
  return SORT_OPTIONS.some((option) => option.value === value);
}

export function filterImages(images: readonly GlobalGalleryImage[], filter: GalleryFilter): GlobalGalleryImage[] {
  if (filter.kind === "all") return [...images];
  if (filter.kind === "unfiled") return images.filter((image) => !image.folderId);
  return images.filter((image) => image.folderId === filter.folderId);
}

/** An unreadable date sorts as the earliest possible. */
function createdTime(image: GlobalGalleryImage): number {
  const time = Date.parse(image.createdAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function nameKey(image: GlobalGalleryImage): string {
  return (image.filename || image.prompt || "").toLowerCase();
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Sorts a copy; images that compare equal keep their loaded order. */
export function sortImages(images: readonly GlobalGalleryImage[], sort: GallerySort): GlobalGalleryImage[] {
  const sorted = [...images];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => compareNumbers(createdTime(b), createdTime(a)));
    case "oldest":
      return sorted.sort((a, b) => compareNumbers(createdTime(a), createdTime(b)));
    case "name-asc":
      return sorted.sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
    case "name-desc":
      return sorted.sort((a, b) => nameKey(b).localeCompare(nameKey(a)));
  }
}

export interface ChipCounts {
  all: number;
  unfiled: number;
  byFolder: ReadonlyMap<string, number>;
}

export function countImages(images: readonly GlobalGalleryImage[]): ChipCounts {
  const byFolder = new Map<string, number>();
  let unfiled = 0;
  for (const image of images) {
    if (image.folderId) byFolder.set(image.folderId, (byFolder.get(image.folderId) ?? 0) + 1);
    else unfiled += 1;
  }
  return { all: images.length, unfiled, byFolder };
}

export function imageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "image" : "images"}`;
}

/** Alt text on the card and in the lightbox. */
export function imageAlt(image: GlobalGalleryImage): string {
  return image.filename || image.prompt || "Gallery image";
}

/** The lightbox dialog's name. */
export function lightboxLabel(image: GlobalGalleryImage): string {
  return image.filename || image.prompt || "Gallery image preview";
}

export function deleteFolderMessage(name: string, imageCount: number): string {
  if (imageCount === 0) return `Delete "${name}"?`;
  return `Delete "${name}"? The ${imageCount} ${imageCount === 1 ? "image" : "images"} inside will move to Unfiled.`;
}

export function uploadLabel(folder: GalleryFolder | undefined): string {
  return folder ? `Upload to "${folder.name ?? ""}"` : "Upload Images";
}

/** Two cards per grid row. */
export function rowsOf<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

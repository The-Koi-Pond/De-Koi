// ──────────────────────────────────────────────
// Custom emoji / sticker model (shared)
// A gallery image can be tagged as ONE custom kind — an emoji or a sticker —
// and given a name. In prompts these surface as `:name:` (emoji) and
// `sticker:name:` (sticker); the selectors and prompt wiring land in later
// changes. Eligibility is gated by pixel dimensions so emojis stay small.
// ──────────────────────────────────────────────

export type CustomKind = "emoji" | "sticker";

/** Patch applied to a gallery image record when tagging/renaming/clearing it. */
export type CustomTagPatch = {
  customKind: CustomKind | null;
  customName: string | null;
  width?: number;
  height?: number;
};

/** Max width AND height (px) for each kind. Over either dimension is rejected. */
const CUSTOM_KIND_MAX_DIMENSION: Record<CustomKind, number> = {
  emoji: 256,
  sticker: 512,
};

/** Hard cap on a custom emoji/sticker name length. */
const CUSTOM_NAME_MAX_LENGTH = 32;

/**
 * Normalize a user-typed name into a token-safe slug: lowercase, with runs of
 * non-alphanumerics collapsed to single underscores and trimmed. Keeps `:name:`
 * references unambiguous and shell/markdown-safe. Returns "" if nothing usable.
 */
export function slugifyCustomName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CUSTOM_NAME_MAX_LENGTH);
}

export type CustomKindValidation = { ok: true } | { ok: false; reason: string };

/** Whether an image of the given dimensions may be tagged as `kind`. */
export function validateDimensionsForKind(width: number, height: number, kind: CustomKind): CustomKindValidation {
  const max = CUSTOM_KIND_MAX_DIMENSION[kind];
  if (width <= max && height <= max) return { ok: true };

  const label = kind === "emoji" ? "an emoji" : "a sticker";
  let reason = `Too large for ${label} — max ${max}×${max}px (this image is ${width}×${height}).`;
  if (
    kind === "emoji" &&
    width <= CUSTOM_KIND_MAX_DIMENSION.sticker &&
    height <= CUSTOM_KIND_MAX_DIMENSION.sticker
  ) {
    reason += " It fits as a sticker, though.";
  }
  return { ok: false, reason };
}

/** Load an image purely to read its natural dimensions. */
export function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not load this image to measure it."));
    img.src = url;
  });
}

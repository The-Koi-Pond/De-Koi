// ──────────────────────────────────────────────
// Image MIME types (shared client + server)
// ──────────────────────────────────────────────

/** MIME types for image responses (used by the server's file serving route). */
export const IMAGE_MIME_MAP: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

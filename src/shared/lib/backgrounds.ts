// ──────────────────────────────────────────────
// Chat background URL <-> metadata helpers
// ──────────────────────────────────────────────

import { USER_BACKGROUND_URL_PREFIX, decodeLocalAssetPath, userBackgroundUrl } from "../api/local-file-api";

export function chatBackgroundMetadataToUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const background = value.trim();
  if (!background) return null;

  if (background.startsWith(USER_BACKGROUND_URL_PREFIX)) {
    return background;
  }
  if (/^(https?:|data:|blob:)/i.test(background) || background.startsWith("/")) {
    return background;
  }

  return userBackgroundUrl(background);
}

export function chatBackgroundUrlToMetadata(url: string | null): string | null {
  if (!url) return null;

  if (url.startsWith(USER_BACKGROUND_URL_PREFIX)) {
    return decodeLocalAssetPath(url.slice(USER_BACKGROUND_URL_PREFIX.length));
  }

  return url;
}

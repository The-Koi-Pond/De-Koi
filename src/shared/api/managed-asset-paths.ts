import { convertFileSrc } from "@tauri-apps/api/core";

export const USER_BACKGROUND_URL_PREFIX = "marinara-background:";
export const GAME_ASSET_URL_PREFIX = "marinara-game-asset:";
export const LOREBOOK_IMAGE_URL_PREFIX = "marinara-lorebook-image:";

function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

export function isAbsoluteFilesystemPath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

function canConvertFileSrc(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as { __TAURI_INTERNALS__?: { convertFileSrc?: unknown } }).__TAURI_INTERNALS__?.convertFileSrc
  );
}

function encodeLocalAssetPath(path: string): string {
  return encodeURIComponent(path.replace(/\\/g, "/"));
}

export function decodeLocalAssetPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function userBackgroundUrl(filename: string): string {
  return `${USER_BACKGROUND_URL_PREFIX}${encodeLocalAssetPath(filename)}`;
}

export function gameAssetUrl(path: string): string {
  return `${GAME_ASSET_URL_PREFIX}${encodeLocalAssetPath(path)}`;
}

export function filePathToAssetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("asset:") || path.startsWith("http://asset.localhost")) return path;
  if (hasScheme(path) && !isAbsoluteFilesystemPath(path)) return path;
  if (!canConvertFileSrc()) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

export function remoteManagedAssetPath(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  const encodedPath = path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map(encodeURIComponent)
    .join("/");
  return encodedPath || null;
}

export function remoteManagedAssetRawPath(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  const normalizedPath = path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
  return normalizedPath || null;
}

export function filenameFromPath(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) return null;
  const filename = value.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim();
  return filename && filename !== "." && filename !== ".." ? filename : null;
}

function managedAvatarPathFromAbsolutePath(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const marker = "/avatars/";
  const markerIndex = lower.lastIndexOf(marker);
  const relative =
    markerIndex >= 0
      ? normalized.slice(markerIndex + marker.length)
      : lower.startsWith("avatars/")
        ? normalized.slice("avatars/".length)
        : null;
  if (!relative) return null;
  const segments = relative
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) {
    return null;
  }
  const collection = segments[0];
  if (!collection || !["characters", "personas", "character-groups", "persona-groups", "npc"].includes(collection)) {
    return null;
  }
  return segments.join("/");
}

export function avatarRemoteManagedPath(
  filename: string | null | undefined,
  absolutePath: string | null | undefined,
): string | null {
  return managedAvatarPathFromAbsolutePath(absolutePath) ?? filename?.trim() ?? filenameFromPath(absolutePath);
}

export function pathExtension(value: string | null | undefined): string | null {
  const filename = filenameFromPath(value);
  const extension = filename?.split(".").pop()?.trim().toLowerCase();
  return extension && extension !== filename?.toLowerCase() ? extension : null;
}

export function inlineImageDataUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(trimmed)) return trimmed;
  const wrapped = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(data:image\/(?:png|jpe?g|webp|gif);base64,.*)$/i);
  return wrapped?.[1] ?? null;
}

export function cacheBustQuery(cacheKey: string | number | null | undefined): string | undefined {
  const value = String(cacheKey ?? "").trim();
  return value ? `v=${encodeURIComponent(value)}` : undefined;
}

export function appendCacheBust(url: string, cacheKey: string | number | null | undefined): string {
  const query = cacheBustQuery(cacheKey);
  if (!query || url.startsWith("blob:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

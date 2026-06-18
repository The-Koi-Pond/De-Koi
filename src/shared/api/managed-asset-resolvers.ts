import { invokeTauri } from "./tauri-client";
import {
  appendCacheBust,
  avatarRemoteManagedPath,
  cacheBustQuery,
  decodeLocalAssetPath,
  filePathToAssetUrl,
  filenameFromPath,
  GAME_ASSET_URL_PREFIX,
  gameAssetUrl,
  isAbsoluteFilesystemPath,
  LOREBOOK_IMAGE_URL_PREFIX,
  USER_BACKGROUND_URL_PREFIX,
  userBackgroundUrl,
} from "./managed-asset-paths";
import { remoteManagedAssetResolvableUrl, remoteManagedAssetUrl } from "./remote-managed-assets";
import { resolveManagedAssetThumbnailFileUrl } from "./managed-asset-thumbnails";

type PathResponse = { path?: string | null };

export function gameAssetFileUrlFromPath(path: string, absolutePath?: string | null): string {
  const remoteUrl = remoteManagedAssetUrl("game", path);
  if (remoteUrl) return remoteUrl;
  return absolutePath ? filePathToAssetUrl(absolutePath) : gameAssetUrl(path);
}

export function backgroundFileUrlFromPath(filename: string, absolutePath?: string | null): string {
  const remoteUrl = remoteManagedAssetUrl("background", filename);
  if (remoteUrl) return remoteUrl;
  return absolutePath ? filePathToAssetUrl(absolutePath) : userBackgroundUrl(filename);
}

export function avatarFileUrlFromPath(
  filename: string | null | undefined,
  absolutePath?: string | null,
): string | null {
  const remoteUrl = remoteManagedAssetUrl("avatar", avatarRemoteManagedPath(filename, absolutePath));
  if (remoteUrl) return remoteUrl;
  return absolutePath ? filePathToAssetUrl(absolutePath) : null;
}

function galleryRemoteManagedPath(
  filename: string | null | undefined,
  absolutePath: string | null | undefined,
): string | null {
  return filename?.trim() || filenameFromPath(absolutePath);
}

function galleryLocalFilename(
  filename: string | null | undefined,
  absolutePath: string | null | undefined,
): string | null {
  return filename?.trim() || filenameFromPath(absolutePath);
}

export async function resolveGameAssetFileUrl(path: string): Promise<string> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("game", path);
  if (remoteUrl) return remoteUrl;
  const response = await invokeTauri<PathResponse>("game_assets_file_path", { path });
  return filePathToAssetUrl(response.path ?? "");
}

async function resolveBackgroundFileUrl(filename: string): Promise<string> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("background", filename);
  if (remoteUrl) return remoteUrl;
  const response = await invokeTauri<PathResponse>("background_file_path", { filename });
  return filePathToAssetUrl(response.path ?? "");
}

export async function resolveFontFileUrl(filename: string, absolutePath?: string | null): Promise<string> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("font", filename);
  if (remoteUrl) return remoteUrl;
  return absolutePath ? filePathToAssetUrl(absolutePath) : "";
}

export async function resolveAvatarFileUrl(
  filename: string | null | undefined,
  absolutePath?: string | null,
): Promise<string | null> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("avatar", avatarRemoteManagedPath(filename, absolutePath));
  if (remoteUrl) return remoteUrl;
  return absolutePath ? filePathToAssetUrl(absolutePath) : null;
}

export async function resolveGalleryFileUrl(
  filename: string | null | undefined,
  absolutePath?: string | null,
): Promise<string | null> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("gallery", galleryRemoteManagedPath(filename, absolutePath));
  if (remoteUrl) return remoteUrl;
  const localFilename = galleryLocalFilename(filename, absolutePath);
  if (!localFilename) return null;
  const response = await invokeTauri<PathResponse>("gallery_file_path", { filename: localFilename });
  return filePathToAssetUrl(response.path ?? "");
}

export function galleryThumbnailPath(filename: string | null | undefined, absolutePath?: string | null): string | null {
  return galleryRemoteManagedPath(filename, absolutePath);
}

function spriteRemoteManagedPath(
  ownerType: string | null | undefined,
  ownerId: string | null | undefined,
  filename: string | null | undefined,
): string | null {
  const normalizedOwnerType = ownerType === "persona" ? "persona" : "character";
  const normalizedOwnerId = ownerId?.trim();
  const normalizedFilename = filename?.trim();
  if (!normalizedOwnerId || !normalizedFilename) return null;
  return `${normalizedOwnerType}/${normalizedOwnerId}/${normalizedFilename}`;
}

export async function resolveSpriteFileUrl(
  ownerType: string | null | undefined,
  ownerId: string | null | undefined,
  filename: string | null | undefined,
  absolutePath?: string | null,
  cacheKey?: string | number | null,
): Promise<string | null> {
  const remoteUrl = await remoteManagedAssetResolvableUrl(
    "sprite",
    spriteRemoteManagedPath(ownerType, ownerId, filename),
    cacheBustQuery(cacheKey),
  );
  if (remoteUrl) return remoteUrl;
  return absolutePath && isAbsoluteFilesystemPath(absolutePath)
    ? appendCacheBust(filePathToAssetUrl(absolutePath), cacheKey)
    : null;
}

async function resolveLorebookImageFileUrl(filename: string): Promise<string> {
  const remoteUrl = await remoteManagedAssetResolvableUrl("lorebook", filename);
  if (remoteUrl) return remoteUrl;
  const response = await invokeTauri<PathResponse>("lorebook_image_file_path", { filename });
  return filePathToAssetUrl(response.path ?? "");
}

export async function resolveManagedLocalAssetThumbnailUrl(
  url: string | null | undefined,
  size = 128,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith(USER_BACKGROUND_URL_PREFIX)) {
    return resolveManagedAssetThumbnailFileUrl(
      "background",
      decodeLocalAssetPath(url.slice(USER_BACKGROUND_URL_PREFIX.length)),
      size,
    );
  }
  if (url.startsWith(GAME_ASSET_URL_PREFIX)) {
    return resolveManagedAssetThumbnailFileUrl(
      "game",
      decodeLocalAssetPath(url.slice(GAME_ASSET_URL_PREFIX.length)),
      size,
    );
  }
  if (url.startsWith(LOREBOOK_IMAGE_URL_PREFIX)) {
    return resolveManagedAssetThumbnailFileUrl(
      "lorebook",
      decodeLocalAssetPath(url.slice(LOREBOOK_IMAGE_URL_PREFIX.length)),
      size,
    );
  }
  return filePathToAssetUrl(url);
}

export async function resolveManagedLocalAssetUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith(USER_BACKGROUND_URL_PREFIX)) {
    return resolveBackgroundFileUrl(decodeLocalAssetPath(url.slice(USER_BACKGROUND_URL_PREFIX.length)));
  }
  if (url.startsWith(GAME_ASSET_URL_PREFIX)) {
    return resolveGameAssetFileUrl(decodeLocalAssetPath(url.slice(GAME_ASSET_URL_PREFIX.length)));
  }
  if (url.startsWith(LOREBOOK_IMAGE_URL_PREFIX)) {
    return resolveLorebookImageFileUrl(decodeLocalAssetPath(url.slice(LOREBOOK_IMAGE_URL_PREFIX.length)));
  }
  return filePathToAssetUrl(url);
}

export async function resolveEntityImageUrl(
  collection: "agents" | "connections",
  imagePath: string | null | undefined,
  imageFilename: string | null | undefined,
): Promise<string | null> {
  const remotePath = imageFilename?.trim() ? `${collection}/${imageFilename}` : null;
  const remoteUrl = await remoteManagedAssetResolvableUrl("entity-image", remotePath);
  if (remoteUrl) return remoteUrl;
  return resolveManagedLocalAssetUrl(imagePath);
}

export { resolveManagedAssetThumbnailFileUrl };

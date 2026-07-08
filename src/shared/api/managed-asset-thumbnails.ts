import { invokeTauri } from "./tauri-client";
import {
  avatarRemoteManagedPath,
  filePathToAssetUrl,
  inlineImageDataUrl,
  pathExtension,
  remoteManagedAssetRawPath,
} from "./managed-asset-paths";
import { remoteManagedAssetResolvableUrl, remoteManagedAssetUrl } from "./remote-managed-assets";
import { remoteRuntimeTarget } from "./remote-runtime";

type PathResponse = { path?: string | null };

export type ManagedAssetThumbnailKind = "background" | "gallery" | "game" | "lorebook";

const pendingAvatarThumbnailResolutions = new Map<string, Promise<string | null>>();
const pendingManagedAssetThumbnailResolutions = new Map<string, Promise<string | null>>();
let activeAvatarThumbnailResolutions = 0;
let activeManagedAssetThumbnailResolutions = 0;
const queuedAvatarThumbnailResolutions: Array<() => void> = [];
const queuedManagedAssetThumbnailResolutions: Array<() => void> = [];
const MAX_ACTIVE_AVATAR_THUMBNAIL_RESOLUTIONS = 2;
const MAX_ACTIVE_MANAGED_ASSET_THUMBNAIL_RESOLUTIONS = 2;

export function managedAssetThumbnailRemotePath(
  kind: ManagedAssetThumbnailKind,
  path: string | null | undefined,
  size: number,
): string | null {
  const normalizedPath = remoteManagedAssetRawPath(path);
  return normalizedPath ? `${kind}/${size}/${normalizedPath}` : null;
}

function inlineAvatarThumbnailRemotePath(path: string | null | undefined, size: number): string | null {
  const filename = path?.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (!filename || !/^[a-f0-9]{64}\.thumb\.png$/i.test(filename)) return null;
  return `${size}/inline/${filename}`;
}

function hashCacheInput(value: string | null | undefined): string {
  const input = value ?? "";
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${input.length}:${(hash >>> 0).toString(16)}`;
}

function runtimeCacheScope(): string {
  const target = remoteRuntimeTarget();
  return target ? `${target.baseUrl}\0${target.authorization ?? ""}` : "embedded";
}

function avatarThumbnailResolutionCacheKey(
  filename: string | null | undefined,
  absolutePath: string | null | undefined,
  size: number,
  sourceUrl: string | null,
): string {
  return [
    runtimeCacheScope(),
    filename?.trim() ?? "",
    absolutePath?.trim() ?? "",
    String(size),
    hashCacheInput(sourceUrl),
  ].join("\0");
}

function managedThumbnailResolutionCacheKey(
  kind: ManagedAssetThumbnailKind,
  path: string | null | undefined,
  size: number,
): string {
  return [runtimeCacheScope(), kind, path?.trim() ?? "", String(size)].join("\0");
}

function scheduleAvatarThumbnailResolution<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeAvatarThumbnailResolutions += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeAvatarThumbnailResolutions -= 1;
          queuedAvatarThumbnailResolutions.shift()?.();
        });
    };
    if (activeAvatarThumbnailResolutions < MAX_ACTIVE_AVATAR_THUMBNAIL_RESOLUTIONS) {
      run();
      return;
    }
    queuedAvatarThumbnailResolutions.push(run);
  });
}

function scheduleManagedAssetThumbnailResolution<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeManagedAssetThumbnailResolutions += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeManagedAssetThumbnailResolutions -= 1;
          queuedManagedAssetThumbnailResolutions.shift()?.();
        });
    };
    if (activeManagedAssetThumbnailResolutions < MAX_ACTIVE_MANAGED_ASSET_THUMBNAIL_RESOLUTIONS) {
      run();
      return;
    }
    queuedManagedAssetThumbnailResolutions.push(run);
  });
}

export function canGenerateAvatarThumbnail(
  filename: string | null | undefined,
  absolutePath?: string | null,
  sourceUrl?: string | null,
): boolean {
  const extension = pathExtension(filename) ?? pathExtension(absolutePath);
  return (
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "webp" ||
    extension === "gif" ||
    !!inlineImageDataUrl(sourceUrl)
  );
}

export function avatarThumbnailFileUrlFromPath(
  filename: string | null | undefined,
  absolutePath?: string | null,
  size = 128,
  sourceUrl?: string | null,
): string | null {
  const path = avatarRemoteManagedPath(filename, absolutePath);
  const remoteUrl = remoteManagedAssetUrl("avatar-thumbnail", path ? `${size}/${path}` : null);
  if (!remoteUrl && inlineImageDataUrl(sourceUrl)) return null;
  return remoteUrl;
}

export async function resolveManagedAssetThumbnailFileUrl(
  kind: ManagedAssetThumbnailKind,
  path: string | null | undefined,
  size = 256,
): Promise<string | null> {
  const cacheKey = managedThumbnailResolutionCacheKey(kind, path, size);
  const pending = pendingManagedAssetThumbnailResolutions.get(cacheKey);
  if (pending) return pending;

  const promise = scheduleManagedAssetThumbnailResolution(async () => {
    const remoteUrl = await remoteManagedAssetResolvableUrl(
      "thumbnail",
      managedAssetThumbnailRemotePath(kind, path, size),
    );
    if (remoteUrl) return remoteUrl;
    if (!path?.trim()) return null;
    const response = await invokeTauri<PathResponse>("managed_asset_thumbnail_file_path", { kind, path, size });
    return filePathToAssetUrl(response.path ?? "");
  });
  pendingManagedAssetThumbnailResolutions.set(cacheKey, promise);
  promise
    .finally(() => {
      if (pendingManagedAssetThumbnailResolutions.get(cacheKey) === promise) {
        pendingManagedAssetThumbnailResolutions.delete(cacheKey);
      }
    })
    .catch(() => {});
  return promise;
}

export async function resolveAvatarThumbnailFileUrl(
  filename: string | null | undefined,
  absolutePath?: string | null,
  size = 128,
  sourceUrl?: string | null,
): Promise<string | null> {
  const normalizedSourceUrl = inlineImageDataUrl(sourceUrl);
  const cacheKey = avatarThumbnailResolutionCacheKey(filename, absolutePath, size, normalizedSourceUrl);
  const pending = pendingAvatarThumbnailResolutions.get(cacheKey);
  if (pending) return pending;
  const promise = scheduleAvatarThumbnailResolution(async () => {
    const remotePath = avatarRemoteManagedPath(filename, absolutePath);
    const remoteUrl = await remoteManagedAssetResolvableUrl(
      "avatar-thumbnail",
      remotePath ? `${size}/${remotePath}` : null,
    );
    if (remoteUrl) return remoteUrl;
    if (!filename && !absolutePath && !normalizedSourceUrl) return null;
    const response = await invokeTauri<PathResponse>("avatar_thumbnail_file_path", {
      filename,
      absolutePath,
      sourceUrl: normalizedSourceUrl,
      size,
    });
    if (normalizedSourceUrl) {
      const inlineRemoteUrl = await remoteManagedAssetResolvableUrl(
        "avatar-thumbnail",
        inlineAvatarThumbnailRemotePath(response.path, size),
      );
      if (inlineRemoteUrl) return inlineRemoteUrl;
    }
    return filePathToAssetUrl(response.path ?? "");
  });
  pendingAvatarThumbnailResolutions.set(cacheKey, promise);
  promise
    .finally(() => {
      if (pendingAvatarThumbnailResolutions.get(cacheKey) === promise) {
        pendingAvatarThumbnailResolutions.delete(cacheKey);
      }
    })
    .catch(() => {});
  return promise;
}

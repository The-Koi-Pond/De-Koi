import { forwardRef, useEffect, useMemo, useState, type CSSProperties } from "react";

import { avatarFileUrlFromPath, resolveAvatarFileUrl } from "../../api/local-file-api";
import { getAvatarCropStyle, parseAvatarCropJson, type AvatarCropValue } from "../../lib/utils";

const RESOLVED_AVATAR_SRC_CACHE_LIMIT = 128;
const resolvedAvatarSrcCache = new Map<string, string>();

function readCachedResolvedAvatarSrc(key: string): string | null {
  return resolvedAvatarSrcCache.get(key) ?? null;
}

function rememberResolvedAvatarSrc(key: string, src: string | null): void {
  resolvedAvatarSrcCache.delete(key);
  if (!src) return;
  resolvedAvatarSrcCache.set(key, src);
  while (resolvedAvatarSrcCache.size > RESOLVED_AVATAR_SRC_CACHE_LIMIT) {
    const oldestKey = resolvedAvatarSrcCache.keys().next().value;
    if (!oldestKey) break;
    resolvedAvatarSrcCache.delete(oldestKey);
  }
}

function hasText(value: string | null | undefined): boolean {
  return !!value?.trim();
}

function isLikelyFilesystemPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return (
    /^[a-z]:\//i.test(normalized) ||
    normalized.startsWith("//") ||
    /^\/(Users|home|var|data|tmp|opt|private)\//i.test(normalized)
  );
}

function resolveAvatarCrop(crop: unknown): AvatarCropValue | null {
  if (!crop) return null;
  if (typeof crop === "string") return parseAvatarCropJson(crop);
  if (typeof crop !== "object") return null;
  try {
    return parseAvatarCropJson(JSON.stringify(crop));
  } catch {
    return null;
  }
}

export const ResolvedAvatarImage = forwardRef<
  HTMLImageElement,
  {
    src?: string | null;
    avatarFilePath?: string | null;
    avatarFilename?: string | null;
    alt: string;
    crop?: unknown;
    loading?: "eager" | "lazy";
    decoding?: "sync" | "async" | "auto";
    draggable?: boolean;
    "aria-hidden"?: boolean | "true" | "false";
    className?: string;
    style?: CSSProperties;
    onResolvedSrc?: (src: string | null) => void;
    onError?: () => void;
  }
>(function ResolvedAvatarImage(
  {
    src,
    avatarFilePath,
    avatarFilename,
    alt,
    crop,
    loading = "lazy",
    decoding = "async",
    draggable,
    "aria-hidden": ariaHidden,
    className,
    style,
    onResolvedSrc,
    onError,
  },
  ref,
) {
  const hasManagedAvatar = hasText(avatarFilename) || hasText(avatarFilePath);
  const fallbackSrc = useMemo(() => {
    if (!src) return null;
    return hasManagedAvatar && isLikelyFilesystemPath(src) ? null : src;
  }, [hasManagedAvatar, src]);
  const immediateSrc = useMemo(() => {
    if (!hasManagedAvatar) return fallbackSrc;
    const syncUrl = avatarFileUrlFromPath(avatarFilename, avatarFilePath);
    if (!syncUrl || isLikelyFilesystemPath(syncUrl)) return fallbackSrc;
    return syncUrl;
  }, [avatarFilePath, avatarFilename, fallbackSrc, hasManagedAvatar]);
  const resolutionKey = JSON.stringify([src ?? "", avatarFilename ?? "", avatarFilePath ?? ""]);
  const cachedResolvedSrc = hasManagedAvatar ? readCachedResolvedAvatarSrc(resolutionKey) : null;
  const [resolvedState, setResolvedState] = useState<{ key: string; src: string | null }>({
    key: resolutionKey,
    src: cachedResolvedSrc ?? immediateSrc,
  });

  useEffect(() => {
    let cancelled = false;
    if (!hasManagedAvatar) {
      setResolvedState({ key: resolutionKey, src: fallbackSrc });
      onResolvedSrc?.(fallbackSrc);
      return () => {
        cancelled = true;
      };
    }

    const cachedSrc = readCachedResolvedAvatarSrc(resolutionKey);
    const nextInitialSrc = cachedSrc ?? immediateSrc;
    setResolvedState({ key: resolutionKey, src: nextInitialSrc });
    if (cachedSrc) {
      onResolvedSrc?.(cachedSrc);
      return () => {
        cancelled = true;
      };
    }
    if (nextInitialSrc) onResolvedSrc?.(nextInitialSrc);
    resolveAvatarFileUrl(avatarFilename, avatarFilePath)
      .then((url) => {
        if (cancelled) return;
        const next = url ?? fallbackSrc;
        rememberResolvedAvatarSrc(resolutionKey, next);
        setResolvedState({ key: resolutionKey, src: next });
        onResolvedSrc?.(next);
      })
      .catch(() => {
        if (cancelled) return;
        rememberResolvedAvatarSrc(resolutionKey, null);
        setResolvedState({ key: resolutionKey, src: fallbackSrc });
        onResolvedSrc?.(fallbackSrc);
      });

    return () => {
      cancelled = true;
    };
  }, [avatarFilePath, avatarFilename, fallbackSrc, hasManagedAvatar, immediateSrc, onResolvedSrc, resolutionKey]);

  const imageSrc =
    resolvedState.key === resolutionKey
      ? (resolvedState.src ?? cachedResolvedSrc ?? immediateSrc)
      : (cachedResolvedSrc ?? immediateSrc);
  if (!imageSrc) return null;

  return (
    <img
      ref={ref}
      src={imageSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      draggable={draggable}
      aria-hidden={ariaHidden}
      className={className}
      style={{ ...getAvatarCropStyle(resolveAvatarCrop(crop)), ...style }}
      onError={onError}
    />
  );
});

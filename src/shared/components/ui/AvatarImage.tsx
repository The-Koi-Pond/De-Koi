import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  avatarFileUrlFromPath,
  avatarThumbnailFileUrlFromPath,
  canGenerateAvatarThumbnail,
  resolveAvatarFileUrl,
  resolveAvatarThumbnailFileUrl,
} from "../../api/local-file-api";
import {
  cn,
  getAvatarCropStyle,
  isLegacyAvatarCrop,
  normalizeAvatarCropValue,
  type AvatarCrop,
  type AvatarCropValue,
} from "../../lib/utils";

export type AvatarImageSizeHint = 64 | 96 | 128 | 256;

const RESOLVED_AVATAR_SRC_CACHE_LIMIT = 128;
const MISSING_RESOLVED_AVATAR_SRC = Symbol("missing-resolved-avatar-src");
const resolvedAvatarSrcCache = new Map<string, string | typeof MISSING_RESOLVED_AVATAR_SRC>();

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

function getAvatarLoadingMode(src: string | null | undefined): "eager" | "lazy" {
  if (!src) return "lazy";
  const value = src.trim().toLowerCase();
  return value.startsWith("data:") || value.startsWith("blob:") ? "eager" : "lazy";
}

function readCachedResolvedAvatarSrc(key: string): { hit: boolean; src: string | null } {
  if (!resolvedAvatarSrcCache.has(key)) return { hit: false, src: null };
  const cached = resolvedAvatarSrcCache.get(key);
  return { hit: true, src: cached === MISSING_RESOLVED_AVATAR_SRC ? null : (cached ?? null) };
}

function rememberResolvedAvatarSrc(key: string, src: string | null): void {
  resolvedAvatarSrcCache.delete(key);
  resolvedAvatarSrcCache.set(key, src ?? MISSING_RESOLVED_AVATAR_SRC);
  while (resolvedAvatarSrcCache.size > RESOLVED_AVATAR_SRC_CACHE_LIMIT) {
    const oldestKey = resolvedAvatarSrcCache.keys().next().value;
    if (!oldestKey) break;
    resolvedAvatarSrcCache.delete(oldestKey);
  }
}

function isSourceRectAvatarCrop(crop: AvatarCropValue | null): crop is AvatarCrop {
  return !!crop && !isLegacyAvatarCrop(crop);
}

function sourceRectCropStyle(
  crop: AvatarCrop,
  image: HTMLImageElement | null,
): CSSProperties {
  const container = image?.parentElement;
  if (!image || !container || image.naturalWidth <= 0 || image.naturalHeight <= 0) return {};
  const containerRect = container.getBoundingClientRect();
  const containerWidth = containerRect.width;
  const containerHeight = containerRect.height;
  if (containerWidth <= 0 || containerHeight <= 0 || crop.srcWidth <= 0 || crop.srcHeight <= 0) return {};

  const cropPixelWidth = crop.srcWidth * image.naturalWidth;
  const cropPixelHeight = crop.srcHeight * image.naturalHeight;
  const scale = Math.max(containerWidth / cropPixelWidth, containerHeight / cropPixelHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const cropCenterX = (crop.srcX + crop.srcWidth / 2) * image.naturalWidth * scale;
  const cropCenterY = (crop.srcY + crop.srcHeight / 2) * image.naturalHeight * scale;

  return {
    position: "absolute",
    width: `${renderedWidth}px`,
    height: `${renderedHeight}px`,
    left: `${containerWidth / 2 - cropCenterX}px`,
    top: `${containerHeight / 2 - cropCenterY}px`,
    right: "auto",
    bottom: "auto",
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "fill",
  };
}

function hasResolvedSourceRectCropStyle(style: CSSProperties): boolean {
  return style.position === "absolute" && typeof style.width === "string" && typeof style.height === "string";
}

function areCropStylesEqual(a: CSSProperties, b: CSSProperties): boolean {
  return (
    a.position === b.position &&
    a.width === b.width &&
    a.height === b.height &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.maxWidth === b.maxWidth &&
    a.maxHeight === b.maxHeight &&
    a.objectFit === b.objectFit
  );
}

function waitForImageResolveSlot(element: HTMLElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const waitForViewport = new Promise<void>((resolve) => {
    if (typeof IntersectionObserver !== "function") {
      resolve();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          resolve();
        }
      },
      { rootMargin: "240px" },
    );
    signal.addEventListener(
      "abort",
      () => {
        observer.disconnect();
        resolve();
      },
      { once: true },
    );
    observer.observe(element);
  });

  return waitForViewport.then(
    () =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const idleWindow = window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
          cancelIdleCallback?: (handle: number) => void;
        };
        const requestIdle = idleWindow.requestIdleCallback;
        let handle: number | null = null;
        const finish = () => {
          if (handle !== null && typeof idleWindow.cancelIdleCallback === "function") {
            idleWindow.cancelIdleCallback(handle);
          } else if (handle !== null) {
            window.clearTimeout(handle);
          }
          resolve();
        };
        signal.addEventListener("abort", finish, { once: true });
        if (typeof requestIdle === "function") {
          handle = requestIdle(finish, { timeout: 600 });
          return;
        }
        handle = window.setTimeout(finish, 80);
      }),
  );
}

type ResolvedAvatarImageProps = {
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
  thumbnailSize?: AvatarImageSizeHint;
  upgradeToFullResolution?: boolean;
  onError?: () => void;
  onResolvedSrc?: (src: string | null) => void;
};

export const ResolvedAvatarImage = forwardRef<HTMLImageElement, ResolvedAvatarImageProps>(
  function ResolvedAvatarImage(
    {
      src,
      avatarFilePath,
      avatarFilename,
      alt,
      crop,
      loading,
      decoding = "async",
      draggable,
      "aria-hidden": ariaHidden,
      className,
      style,
      thumbnailSize,
      upgradeToFullResolution = false,
      onError,
      onResolvedSrc,
    },
    ref,
  ) {
    const localImageRef = useRef<HTMLImageElement | null>(null);
    const setImageRef = (node: HTMLImageElement | null) => {
      localImageRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const hasManagedAvatar = hasText(avatarFilename) || hasText(avatarFilePath);
    const effectiveThumbnailSize =
      thumbnailSize && canGenerateAvatarThumbnail(avatarFilename, avatarFilePath, src) ? thumbnailSize : undefined;
    const fallbackSrc = useMemo(() => {
      if (!src) return null;
      return hasManagedAvatar && isLikelyFilesystemPath(src) ? null : src;
    }, [hasManagedAvatar, src]);
    const syncFullSrc = useMemo(
      () => (hasManagedAvatar ? avatarFileUrlFromPath(avatarFilename, avatarFilePath) : null),
      [avatarFilePath, avatarFilename, hasManagedAvatar],
    );
    const previewSrc = useMemo(() => {
      if (!effectiveThumbnailSize) return null;
      return avatarThumbnailFileUrlFromPath(avatarFilename, avatarFilePath, effectiveThumbnailSize, src);
    }, [avatarFilePath, avatarFilename, effectiveThumbnailSize, src]);
    const immediateSrc = previewSrc ?? syncFullSrc ?? fallbackSrc;
    const resolutionKey = JSON.stringify([
      src ?? "",
      avatarFilename ?? "",
      avatarFilePath ?? "",
      effectiveThumbnailSize ?? "full",
      upgradeToFullResolution ? "upgrade" : "preview",
    ]);
    const cachedResolvedSrcEntry = hasManagedAvatar
      ? readCachedResolvedAvatarSrc(resolutionKey)
      : { hit: false, src: null };
    const cachedResolvedSrc = cachedResolvedSrcEntry.hit ? cachedResolvedSrcEntry.src : null;
    const [resolvedState, setResolvedState] = useState<{ key: string; src: string | null }>({
      key: resolutionKey,
      src: cachedResolvedSrcEntry.hit ? cachedResolvedSrcEntry.src : immediateSrc,
    });
    const [sourceRectCropStyleState, setSourceRectCropStyleState] = useState<{
      key: string;
      style: CSSProperties;
    }>({ key: "", style: {} });
    const resolvedCrop = useMemo(() => normalizeAvatarCropValue(crop), [crop]);

    useEffect(() => {
      let cancelled = false;
      const abort = new AbortController();
      if (!hasManagedAvatar) {
        setResolvedState({ key: resolutionKey, src: fallbackSrc });
        onResolvedSrc?.(fallbackSrc);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }

      const cachedSrc = readCachedResolvedAvatarSrc(resolutionKey);
      const nextInitialSrc = cachedSrc.hit ? cachedSrc.src : immediateSrc;
      setResolvedState({ key: resolutionKey, src: nextInitialSrc });
      if (cachedSrc.hit) {
        onResolvedSrc?.(cachedSrc.src);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }
      if (syncFullSrc && !isLikelyFilesystemPath(syncFullSrc) && (!effectiveThumbnailSize || upgradeToFullResolution)) {
        rememberResolvedAvatarSrc(resolutionKey, syncFullSrc);
        setResolvedState({ key: resolutionKey, src: syncFullSrc });
        onResolvedSrc?.(syncFullSrc);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }

      const resolveSrc = async () => {
        if (effectiveThumbnailSize && localImageRef.current) {
          await waitForImageResolveSlot(localImageRef.current, abort.signal);
        }
        if (cancelled) return null;
        if (effectiveThumbnailSize) {
          const thumbnailUrl = await resolveAvatarThumbnailFileUrl(
            avatarFilename,
            avatarFilePath,
            effectiveThumbnailSize,
            src,
          ).catch(() => null);
          if (!cancelled && thumbnailUrl) {
            rememberResolvedAvatarSrc(resolutionKey, thumbnailUrl);
            setResolvedState({ key: resolutionKey, src: thumbnailUrl });
            onResolvedSrc?.(thumbnailUrl);
            if (!upgradeToFullResolution) return thumbnailUrl;
          }
        }
        if (cancelled) return null;
        return resolveAvatarFileUrl(avatarFilename, avatarFilePath);
      };

      resolveSrc()
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
        abort.abort();
      };
    }, [
      avatarFilePath,
      avatarFilename,
      effectiveThumbnailSize,
      fallbackSrc,
      hasManagedAvatar,
      immediateSrc,
      onResolvedSrc,
      resolutionKey,
      syncFullSrc,
      upgradeToFullResolution,
    ]);

    const imageSrc =
      resolvedState.key === resolutionKey
        ? (resolvedState.src ?? (cachedResolvedSrcEntry.hit ? cachedResolvedSrc : immediateSrc))
        : (cachedResolvedSrcEntry.hit ? cachedResolvedSrc : immediateSrc);

    const sourceRectCropStyleKey = useMemo(
      () => JSON.stringify([imageSrc ?? "", resolvedCrop ?? null]),
      [imageSrc, resolvedCrop],
    );
    const updateSourceRectCropStyle = useCallback(() => {
      const nextStyle = isSourceRectAvatarCrop(resolvedCrop) ? sourceRectCropStyle(resolvedCrop, localImageRef.current) : {};
      setSourceRectCropStyleState((current) => {
        if (current.key === sourceRectCropStyleKey && areCropStylesEqual(current.style, nextStyle)) {
          return current;
        }
        return {
          key: sourceRectCropStyleKey,
          style: nextStyle,
        };
      });
    }, [resolvedCrop, sourceRectCropStyleKey]);

    useLayoutEffect(() => {
      updateSourceRectCropStyle();
      const image = localImageRef.current;
      const container = image?.parentElement;
      if (!image || !container || !isSourceRectAvatarCrop(resolvedCrop) || typeof ResizeObserver !== "function") {
        return;
      }
      const observer = new ResizeObserver(updateSourceRectCropStyle);
      observer.observe(container);
      observer.observe(image);
      return () => observer.disconnect();
    }, [imageSrc, resolvedCrop, updateSourceRectCropStyle]);

    if (!imageSrc) return null;

    const cropStyle = isSourceRectAvatarCrop(resolvedCrop)
      ? sourceRectCropStyleState.style
      : getAvatarCropStyle(resolvedCrop);
    const isSourceRectCropPending =
      isSourceRectAvatarCrop(resolvedCrop) &&
      (sourceRectCropStyleState.key !== sourceRectCropStyleKey ||
        !hasResolvedSourceRectCropStyle(sourceRectCropStyleState.style));
    const pendingCropStyle: CSSProperties = isSourceRectCropPending ? { visibility: "hidden" } : {};

    return (
      <img
        ref={setImageRef}
        src={imageSrc}
        alt={alt}
        loading={loading ?? getAvatarLoadingMode(imageSrc)}
        decoding={decoding}
        fetchPriority={effectiveThumbnailSize && imageSrc === previewSrc ? "low" : undefined}
        draggable={draggable}
        aria-hidden={ariaHidden}
        className={className}
        style={{ ...style, ...cropStyle, ...pendingCropStyle }}
        onError={onError}
        onLoad={updateSourceRectCropStyle}
      />
    );
  },
);

export function AvatarImage({
  className,
  imageClassName,
  style,
  imageStyle,
  crop,
  ...props
}: Omit<ResolvedAvatarImageProps, "className" | "style"> & {
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  imageStyle?: CSSProperties;
}) {
  return (
    <span className={cn("relative block h-full w-full overflow-hidden", className)} style={style}>
      <ResolvedAvatarImage
        {...props}
        crop={crop}
        className={cn("h-full w-full object-cover", imageClassName)}
        style={imageStyle}
      />
    </span>
  );
}

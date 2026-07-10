import { useEffect, useRef, useState } from "react";

import { fetchBotBrowserAssetBlob } from "../api/bot-browser-api";
import { botBrowserAssetImageCache, type AssetImageCache } from "../lib/asset-image-cache";

type BotBrowserAssetImageProps = {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  onError: () => void;
  cache?: AssetImageCache<Blob>;
  resolveBlob?: (src: string) => Promise<Blob>;
};

export function BotBrowserAssetImage({
  src,
  alt,
  className,
  loading,
  onError,
  cache = botBrowserAssetImageCache,
  resolveBlob = fetchBotBrowserAssetBlob,
}: BotBrowserAssetImageProps) {
  const requiresProxyResolution = src.startsWith("tauri-api:");
  const [resolvedSrc, setResolvedSrc] = useState(() => (requiresProxyResolution ? "" : src));
  const [shouldResolve, setShouldResolve] = useState(() => loading !== "lazy" || !requiresProxyResolution);
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const resolvingSourceRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    resolvingSourceRef.current = null;
    setResolvedSrc(requiresProxyResolution ? "" : src);
    setShouldResolve(loading !== "lazy" || !requiresProxyResolution);
  }, [loading, requiresProxyResolution, src]);

  useEffect(() => {
    if (shouldResolve || !requiresProxyResolution) return;
    const placeholder = placeholderRef.current;
    if (!placeholder || typeof IntersectionObserver === "undefined") {
      setShouldResolve(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldResolve(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [requiresProxyResolution, shouldResolve]);

  useEffect(() => {
    if (!shouldResolve || !requiresProxyResolution || resolvingSourceRef.current === src) return;
    resolvingSourceRef.current = src;
    let cancelled = false;
    let objectUrl: string | null = null;

    void cache
      .resolve(src, resolveBlob)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        resolvingSourceRef.current = null;
        onErrorRef.current();
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cache, requiresProxyResolution, resolveBlob, shouldResolve, src]);

  if (!resolvedSrc) return <span ref={placeholderRef} className={className} aria-hidden="true" />;
  return <img src={resolvedSrc} alt={alt} loading={loading} className={className} onError={onError} />;
}

export interface AssetImageCache {
  resolve: (src: string, resolver: (src: string) => Promise<string>) => Promise<string>;
  clear: () => void;
}

function revokeResolvedObjectUrl(resolution: Promise<string>): void {
  void resolution
    .then((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    })
    .catch(() => {});
}

export function createAssetImageCache(maxEntries = 192): AssetImageCache {
  const entries = new Map<string, Promise<string>>();
  const capacity = Math.max(1, maxEntries);

  return {
    resolve(src, resolver) {
      const cached = entries.get(src);
      if (cached) {
        entries.delete(src);
        entries.set(src, cached);
        return cached;
      }

      while (entries.size >= capacity) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldest = entries.get(oldestKey);
        entries.delete(oldestKey);
        if (oldest) revokeResolvedObjectUrl(oldest);
      }

      let pending: Promise<string>;
      pending = resolver(src).catch((error) => {
        if (entries.get(src) === pending) entries.delete(src);
        throw error;
      });
      entries.set(src, pending);
      return pending;
    },
    clear() {
      for (const resolution of entries.values()) revokeResolvedObjectUrl(resolution);
      entries.clear();
    },
  };
}

export const botBrowserAssetImageCache = createAssetImageCache();

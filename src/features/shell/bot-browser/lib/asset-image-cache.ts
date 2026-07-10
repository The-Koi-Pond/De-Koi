export interface AssetImageCache<T> {
  resolve: (src: string, resolver: (src: string) => Promise<T>) => Promise<T>;
  clear: () => void;
}

export function createAssetImageCache<T = string>(maxEntries = 192): AssetImageCache<T> {
  const entries = new Map<string, Promise<T>>();
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
        entries.delete(oldestKey);
      }

      const pending = resolver(src).catch((error) => {
        if (entries.get(src) === pending) entries.delete(src);
        throw error;
      });
      entries.set(src, pending);
      return pending;
    },
    clear() {
      entries.clear();
    },
  };
}

export const botBrowserAssetImageCache = createAssetImageCache<Blob>();

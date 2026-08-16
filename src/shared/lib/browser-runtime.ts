type ServiceWorkerRegistrationLike = {
  unregister: () => Promise<boolean>;
};

type ServiceWorkerContainerLike = {
  getRegistrations: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
};

type CacheStorageLike = {
  keys: () => Promise<readonly string[]>;
  delete: (cacheName: string) => Promise<boolean>;
};

type ClearBrowserRuntimeCachesOptions = {
  serviceWorker?: ServiceWorkerContainerLike | null;
  cacheStorage?: CacheStorageLike | null;
};

type ForceRefreshSpaOptions = {
  queryParamKey?: string;
  queryParamValue?: string;
  currentUrl?: string;
  clearCaches?: () => Promise<void>;
  replaceLocation?: (url: string) => void;
};

type RegisterPreloadErrorRecoveryOptions = {
  eventTarget?: EventTarget;
  sessionStorage?: Storage | null;
  now?: () => number;
  refreshSpa?: (options: ForceRefreshSpaOptions) => Promise<void>;
};

const PRELOAD_RECOVERY_AT_KEY = "de-koi-preload-recovery-at";
const PRELOAD_RECOVERY_COOLDOWN_MS = 20_000;

function currentServiceWorkerContainer(): ServiceWorkerContainerLike | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker;
}

function currentCacheStorage(): CacheStorageLike | null {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  return window.caches;
}

function currentSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export async function clearBrowserRuntimeCaches({
  serviceWorker = currentServiceWorkerContainer(),
  cacheStorage = currentCacheStorage(),
}: ClearBrowserRuntimeCachesOptions = {}) {
  if (serviceWorker) {
    let registrations: readonly ServiceWorkerRegistrationLike[] = [];
    try {
      registrations = await serviceWorker.getRegistrations();
    } catch {
      registrations = [];
    }
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  }

  if (cacheStorage) {
    let cacheNames: readonly string[] = [];
    try {
      cacheNames = await cacheStorage.keys();
    } catch {
      cacheNames = [];
    }
    await Promise.allSettled(cacheNames.map((cacheName) => cacheStorage.delete(cacheName)));
  }
}

export async function forceRefreshSpa({
  queryParamKey = "spa_refresh",
  queryParamValue = Date.now().toString(),
  currentUrl = typeof window === "undefined" ? "" : window.location.href,
  clearCaches = clearBrowserRuntimeCaches,
  replaceLocation = (url) => window.location.replace(url),
}: ForceRefreshSpaOptions = {}) {
  await clearCaches();
  if (!currentUrl || typeof window === "undefined") return;

  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set(queryParamKey, queryParamValue);
  replaceLocation(nextUrl.toString());
}

export function registerPreloadErrorRecovery({
  eventTarget = typeof window === "undefined" ? undefined : window,
  sessionStorage: storage = currentSessionStorage(),
  now = Date.now,
  refreshSpa = forceRefreshSpa,
}: RegisterPreloadErrorRecoveryOptions = {}) {
  if (!eventTarget || !storage) return () => undefined;

  const handlePreloadError = (event: Event) => {
    try {
      const currentTime = now();
      const previousTime = Number(storage.getItem(PRELOAD_RECOVERY_AT_KEY) ?? "0");
      if (
        Number.isFinite(previousTime) &&
        previousTime > 0 &&
        currentTime - previousTime < PRELOAD_RECOVERY_COOLDOWN_MS
      ) {
        return;
      }

      storage.setItem(PRELOAD_RECOVERY_AT_KEY, currentTime.toString());
      event.preventDefault();
      void refreshSpa({ queryParamKey: "chunk_reload" });
    } catch {
      // Without session storage, recovery cannot be guarded against a reload loop.
    }
  };

  eventTarget.addEventListener("vite:preloadError", handlePreloadError);
  return () => eventTarget.removeEventListener("vite:preloadError", handlePreloadError);
}

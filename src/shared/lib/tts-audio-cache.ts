// ──────────────────────────────────────────────
// Persistent TTS audio cache
// ──────────────────────────────────────────────

const DB_NAME = "marinara-tts-audio-cache";
const DB_VERSION = 1;
const STORE_NAME = "voiceLines";
const MAX_MEMORY_ENTRIES = 150;

type CachedVoiceLine = {
  key: string;
  blob: Blob;
  createdAt: number;
  lastUsedAt: number;
  size: number;
};

/**
 * One voice line being made. Everyone who asks for it while it is on its way shares the request, but each caller
 * waits with their own signal: a caller that gives up stops only its own wait, and the request itself is cancelled
 * once nobody is waiting for it any more.
 */
interface PendingLine {
  readonly keys: string[];
  readonly controller: AbortController;
  readonly promise: Promise<Blob>;
  waiters: number;
}

const memoryCache = new Map<string, Blob>();
const inFlight = new Map<string, PendingLine>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function forgetPendingLine(line: PendingLine) {
  for (const key of line.keys) {
    if (inFlight.get(key) === line) inFlight.delete(key);
  }
}

/** Waits for a shared line on behalf of one caller. Without a signal the caller waits until it is made. */
function waitForLine(line: PendingLine, signal: AbortSignal | undefined): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(abortError());
  line.waiters += 1;
  if (!signal) return line.promise;
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
      line.waiters -= 1;
      if (line.waiters > 0) return;
      // Nobody wants this line any more: cancel its request, and let the next caller start a fresh one.
      forgetPendingLine(line);
      line.controller.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    line.promise.then(
      (blob) => {
        signal.removeEventListener("abort", onAbort);
        resolve(blob);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function rememberInMemory(key: string, blob: Blob) {
  memoryCache.delete(key);
  memoryCache.set(key, blob);
  while (memoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "key" });

      if (store && !store.indexNames.contains("lastUsedAt")) {
        store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

async function getPersistentBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise<CachedVoiceLine | undefined>(store.get(key));
    if (!record?.blob) return null;

    void transactionDone(tx).catch(() => {});
    void (async () => {
      try {
        const writeTx = db.transaction(STORE_NAME, "readwrite");
        writeTx.objectStore(STORE_NAME).put({ ...record, lastUsedAt: Date.now() });
        await transactionDone(writeTx);
      } catch {
        // Best-effort recency update only.
      }
    })();

    return record.blob;
  } catch {
    return null;
  }
}

async function putPersistentBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;

  try {
    const now = Date.now();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      key,
      blob,
      createdAt: now,
      lastUsedAt: now,
      size: blob.size,
    } satisfies CachedVoiceLine);
    await transactionDone(tx);
  } catch {
    // Memory cache still protects this runtime even if IndexedDB is unavailable.
  }
}

async function getCachedTTSAudioBlob(key: string): Promise<Blob | null> {
  const memoryHit = memoryCache.get(key);
  if (memoryHit) {
    rememberInMemory(key, memoryHit);
    return memoryHit;
  }

  const persisted = await getPersistentBlob(key);
  if (persisted) rememberInMemory(key, persisted);
  return persisted;
}

/**
 * The cached audio for `key` (or one of its aliases), made with `create` when there is none. A line already being
 * made for any of the keys is shared. `signal` is this caller's own: aborting it rejects only this call (with an
 * AbortError), and `create`'s signal aborts once every caller waiting for the line has given up.
 */
export async function getOrCreateCachedTTSAudioBlob(
  key: string,
  create: (signal: AbortSignal) => Promise<Blob>,
  aliases: string[] = [],
  signal?: AbortSignal,
): Promise<Blob> {
  const keys = [...new Set([key, ...aliases].filter(Boolean))];

  for (const cacheKey of keys) {
    const cached = await getCachedTTSAudioBlob(cacheKey);
    if (cached) {
      if (cacheKey !== key) {
        rememberInMemory(key, cached);
        await putPersistentBlob(key, cached);
      }
      return cached;
    }
  }
  if (signal?.aborted) throw abortError();

  for (const cacheKey of keys) {
    const pending = inFlight.get(cacheKey);
    if (pending) {
      const blob = await waitForLine(pending, signal);
      if (!pending.keys.includes(key)) {
        rememberInMemory(key, blob);
        await putPersistentBlob(key, blob);
      }
      return blob;
    }
  }

  const controller = new AbortController();
  const promise = (async () => {
    for (const cacheKey of keys) {
      const secondLook = await getCachedTTSAudioBlob(cacheKey);
      if (secondLook) {
        if (cacheKey !== key) {
          rememberInMemory(key, secondLook);
          await putPersistentBlob(key, secondLook);
        }
        return secondLook;
      }
    }
    if (controller.signal.aborted) throw abortError();

    const blob = await create(controller.signal);
    for (const cacheKey of keys) {
      rememberInMemory(cacheKey, blob);
      await putPersistentBlob(cacheKey, blob);
    }
    return blob;
  })().finally(() => forgetPendingLine(line));
  // Every waiter reads the outcome itself; a line nobody waits for any more must not report an unhandled rejection.
  promise.catch(() => undefined);
  const line: PendingLine = { keys, controller, promise, waiters: 0 };

  for (const cacheKey of keys) {
    inFlight.set(cacheKey, line);
  }
  return waitForLine(line, signal);
}

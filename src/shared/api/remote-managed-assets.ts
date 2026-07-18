import { remoteHeaders, remoteRuntimeTarget, type RuntimeTarget } from "./remote-runtime";
import { remoteManagedAssetPath } from "./managed-asset-paths";

export type RemoteManagedAssetKind =
  | "avatar"
  | "avatar-thumbnail"
  | "background"
  | "entity-image"
  | "font"
  | "gallery"
  | "game"
  | "lorebook"
  | "sprite"
  | "thumbnail";

type RemoteManagedAsset = {
  url: string;
  target: RuntimeTarget;
};

type RemoteAssetObjectUrlEntry = {
  promise: Promise<string>;
  objectUrl?: string;
  byteSize: number;
  lastAccess: number;
};

const REMOTE_MANAGED_ASSET_INVALIDATION_QUERY = "mriAssetV";
const REMOTE_ASSET_CACHE_MAX_ENTRIES = 64;
const REMOTE_ASSET_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const remoteAssetObjectUrls = new Map<string, RemoteAssetObjectUrlEntry>();
const remoteAssetInvalidationVersions = new Map<string, number>();
let remoteAssetInvalidationVersion = 0;
let remoteAssetGlobalInvalidationVersion = 0;
let remoteAssetAccessSequence = 0;

function remoteAssetSizeError(): Error {
  return new Error("Remote managed asset exceeds the in-memory limit.");
}

async function readRemoteAssetBlob(response: Response): Promise<Blob> {
  const declaredBytes = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > REMOTE_ASSET_CACHE_MAX_BYTES) {
    throw remoteAssetSizeError();
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > REMOTE_ASSET_CACHE_MAX_BYTES) throw remoteAssetSizeError();
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > REMOTE_ASSET_CACHE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw remoteAssetSizeError();
      }
      if (
        value.buffer instanceof ArrayBuffer &&
        value.byteOffset === 0 &&
        value.byteLength === value.buffer.byteLength
      ) {
        chunks.push(value.buffer);
      } else if (value.buffer instanceof ArrayBuffer) {
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      } else {
        chunks.push(Uint8Array.from(value).buffer);
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return new Blob(chunks, {
    type: response.headers.get("Content-Type") ?? "",
  });
}

function nextRemoteAssetAccess(): number {
  remoteAssetAccessSequence += 1;
  if (!Number.isSafeInteger(remoteAssetAccessSequence)) remoteAssetAccessSequence = 1;
  return remoteAssetAccessSequence;
}

function nextRemoteAssetInvalidationVersion(): number {
  remoteAssetInvalidationVersion += 1;
  if (!Number.isSafeInteger(remoteAssetInvalidationVersion)) {
    remoteAssetInvalidationVersion = 1;
  }
  return remoteAssetInvalidationVersion;
}

function remoteAssetKindVersionKey(kind: RemoteManagedAssetKind): string {
  return `kind:${kind}`;
}

function remoteAssetPathVersionKey(kind: RemoteManagedAssetKind, encodedPath: string): string {
  return `path:${kind}:${encodedPath}`;
}

function sourceThumbnailPathVersionKey(kind: RemoteManagedAssetKind, encodedPath: string): string {
  return `thumbnail:${kind}:${encodedPath}`;
}

function remoteManagedAssetInvalidationVersion(kind: RemoteManagedAssetKind, encodedPath: string): number {
  const thumbnailSourceVersion =
    kind === "thumbnail" ? remoteManagedAssetThumbnailSourceInvalidationVersion(encodedPath) : 0;
  return Math.max(
    remoteAssetGlobalInvalidationVersion,
    remoteAssetInvalidationVersions.get(remoteAssetKindVersionKey(kind)) ?? 0,
    remoteAssetInvalidationVersions.get(remoteAssetPathVersionKey(kind, encodedPath)) ?? 0,
    thumbnailSourceVersion,
  );
}

function remoteManagedAssetThumbnailSourceInvalidationVersion(encodedPath: string): number {
  const [kind, , ...sourceSegments] = encodedPath.split("/");
  const sourcePath = sourceSegments.join("/");
  if (!kind || !sourcePath) return 0;
  return Math.max(
    remoteAssetInvalidationVersions.get(remoteAssetKindVersionKey(kind as RemoteManagedAssetKind)) ?? 0,
    remoteAssetInvalidationVersions.get(sourceThumbnailPathVersionKey(kind as RemoteManagedAssetKind, sourcePath)) ?? 0,
  );
}

function mergeQueryParts(...parts: Array<string | undefined>): string | undefined {
  const query = parts.filter((part): part is string => Boolean(part)).join("&");
  return query || undefined;
}

function remoteManagedAsset(
  kind: RemoteManagedAssetKind,
  path: string | null | undefined,
  query?: string,
): RemoteManagedAsset | null {
  const target = remoteRuntimeTarget();
  const encodedPath = remoteManagedAssetPath(path);
  if (!target || !encodedPath) return null;
  const invalidationVersion = remoteManagedAssetInvalidationVersion(kind, encodedPath);
  const invalidationQuery = invalidationVersion
    ? `${REMOTE_MANAGED_ASSET_INVALIDATION_QUERY}=${invalidationVersion}`
    : undefined;
  const mergedQuery = mergeQueryParts(query, invalidationQuery);
  const querySuffix = mergedQuery ? `?${mergedQuery}` : "";
  return { url: `${target.baseUrl}/api/assets/${kind}/${encodedPath}${querySuffix}`, target };
}

export function remoteManagedAssetUrl(
  kind: RemoteManagedAssetKind,
  path: string | null | undefined,
  query?: string,
): string | null {
  const asset = remoteManagedAsset(kind, path, query);
  if (!asset || asset.target.authorization) return null;
  return asset.url;
}

export async function remoteManagedAssetResolvableUrl(
  kind: RemoteManagedAssetKind,
  path: string | null | undefined,
  query?: string,
): Promise<string | null> {
  const asset = remoteManagedAsset(kind, path, query);
  if (!asset) return null;
  if (!asset.target.authorization) return asset.url;
  return fetchRemoteManagedAssetBlobUrl(asset);
}

async function fetchRemoteManagedAssetBlobUrl(asset: RemoteManagedAsset): Promise<string> {
  const cacheKey = remoteManagedAssetCacheKey(asset);
  const cached = remoteAssetObjectUrls.get(cacheKey);
  if (cached) {
    cached.lastAccess = nextRemoteAssetAccess();
    return cached.promise;
  }

  const entry: RemoteAssetObjectUrlEntry = {
    promise: Promise.resolve(""),
    byteSize: 0,
    lastAccess: nextRemoteAssetAccess(),
  };
  entry.promise = (async () => {
    const response = await fetch(asset.url, {
      method: "GET",
      headers: remoteHeaders(asset.target),
    });
    if (!response.ok) {
      throw new Error(`Remote managed asset returned ${response.status}`);
    }
    const blob = await readRemoteAssetBlob(response);
    const objectUrl = URL.createObjectURL(blob);
    entry.objectUrl = objectUrl;
    entry.byteSize = blob.size;
    evictRemoteAssetObjectUrls();
    return objectUrl;
  })();

  remoteAssetObjectUrls.set(cacheKey, entry);
  entry.promise.catch(() => {
    revokeRemoteAssetObjectUrl(entry);
    entry.objectUrl = undefined;
    entry.byteSize = 0;
    if (remoteAssetObjectUrls.get(cacheKey) === entry) {
      remoteAssetObjectUrls.delete(cacheKey);
    }
  });
  return entry.promise;
}

function evictRemoteAssetObjectUrls(): void {
  const retainedBytes = () => [...remoteAssetObjectUrls.values()].reduce((total, entry) => total + entry.byteSize, 0);
  while (
    remoteAssetObjectUrls.size > REMOTE_ASSET_CACHE_MAX_ENTRIES ||
    retainedBytes() > REMOTE_ASSET_CACHE_MAX_BYTES
  ) {
    const oldest = [...remoteAssetObjectUrls.entries()]
      .filter(([, entry]) => Boolean(entry.objectUrl))
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
    if (!oldest) return;
    deleteRemoteAssetObjectUrl(oldest[0]);
  }
}

function remoteManagedAssetCacheKey(asset: RemoteManagedAsset): string {
  return `${asset.target.baseUrl}\0${asset.target.authorization ?? ""}\0${asset.url}`;
}

function revokeRemoteAssetObjectUrl(entry: RemoteAssetObjectUrlEntry): void {
  if (entry.objectUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(entry.objectUrl);
  }
}

function deleteRemoteAssetObjectUrl(cacheKey: string): void {
  const entry = remoteAssetObjectUrls.get(cacheKey);
  if (!entry) return;
  remoteAssetObjectUrls.delete(cacheKey);
  if (entry.objectUrl) {
    revokeRemoteAssetObjectUrl(entry);
    return;
  }
  entry.promise
    .then((objectUrl) => {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(objectUrl);
      }
    })
    .catch(() => {});
}

export function invalidateRemoteManagedAssetObjectUrls(kind?: RemoteManagedAssetKind, path?: string | null): void {
  if (kind && path) {
    const asset = remoteManagedAsset(kind, path);
    const encodedPath = remoteManagedAssetPath(path);
    if (encodedPath) {
      remoteAssetInvalidationVersions.set(
        remoteAssetPathVersionKey(kind, encodedPath),
        nextRemoteAssetInvalidationVersion(),
      );
      remoteAssetInvalidationVersions.set(
        sourceThumbnailPathVersionKey(kind, encodedPath),
        nextRemoteAssetInvalidationVersion(),
      );
    }
    if (asset) deleteRemoteAssetObjectUrl(remoteManagedAssetCacheKey(asset));
    const routeMarker = `/api/assets/thumbnail/${kind}/`;
    for (const cacheKey of [...remoteAssetObjectUrls.keys()]) {
      if (cacheKey.includes(routeMarker)) deleteRemoteAssetObjectUrl(cacheKey);
    }
    return;
  }
  if (kind) {
    remoteAssetInvalidationVersions.set(remoteAssetKindVersionKey(kind), nextRemoteAssetInvalidationVersion());
    const routeMarker = `/api/assets/${kind}/`;
    const thumbnailRouteMarker = `/api/assets/thumbnail/${kind}/`;
    for (const cacheKey of [...remoteAssetObjectUrls.keys()]) {
      if (cacheKey.includes(routeMarker) || cacheKey.includes(thumbnailRouteMarker)) {
        deleteRemoteAssetObjectUrl(cacheKey);
      }
    }
    return;
  }

  remoteAssetGlobalInvalidationVersion = nextRemoteAssetInvalidationVersion();
  for (const cacheKey of [...remoteAssetObjectUrls.keys()]) {
    deleteRemoteAssetObjectUrl(cacheKey);
  }
}

export async function invalidateRemoteManagedAssetObjectUrlsAfter<T>(
  operation: Promise<T>,
  kinds: RemoteManagedAssetKind | RemoteManagedAssetKind[],
): Promise<T> {
  const result = await operation;
  for (const kind of Array.isArray(kinds) ? kinds : [kinds]) {
    invalidateRemoteManagedAssetObjectUrls(kind);
  }
  return result;
}

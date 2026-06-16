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
};

const REMOTE_MANAGED_ASSET_INVALIDATION_QUERY = "mriAssetV";
const remoteAssetObjectUrls = new Map<string, RemoteAssetObjectUrlEntry>();
const remoteAssetInvalidationVersions = new Map<string, number>();
let remoteAssetInvalidationVersion = 0;
let remoteAssetGlobalInvalidationVersion = 0;

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
  if (cached) return cached.promise;

  const entry: RemoteAssetObjectUrlEntry = { promise: Promise.resolve("") };
  entry.promise = (async () => {
    const response = await fetch(asset.url, {
      method: "GET",
      headers: remoteHeaders(asset.target),
    });
    if (!response.ok) {
      throw new Error(`Remote managed asset returned ${response.status}`);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    entry.objectUrl = objectUrl;
    return objectUrl;
  })();

  remoteAssetObjectUrls.set(cacheKey, entry);
  entry.promise.catch(() => {
    if (remoteAssetObjectUrls.get(cacheKey) === entry) {
      remoteAssetObjectUrls.delete(cacheKey);
    }
  });
  return entry.promise;
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

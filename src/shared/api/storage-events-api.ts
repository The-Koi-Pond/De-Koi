import { remoteRuntimeTarget, streamRemoteJsonEvents } from "./remote-runtime";

export type StorageEventsMessage = { type: "ready" } | { type: "storage_changed"; collections: string[] };

/** True when the app talks to a hosted runtime (the Pi), where other devices can change the same data. */
export function storageEventsAvailable(): boolean {
  return remoteRuntimeTarget() !== null;
}

/**
 * One connection to the hosted runtime's live storage-change stream. Resolves when the server closes it and
 * rejects on network errors; callers reconnect.
 */
export async function readStorageEvents(
  onMessage: (message: StorageEventsMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  for await (const event of streamRemoteJsonEvents("/api/events/stream", {}, { signal })) {
    if (event.type === "ready") {
      onMessage({ type: "ready" });
    } else if (event.type === "storage_changed") {
      const data = event.data && typeof event.data === "object" ? (event.data as { collections?: unknown }) : {};
      const collections = Array.isArray(data.collections)
        ? data.collections.filter((value): value is string => typeof value === "string")
        : [];
      if (collections.length > 0) onMessage({ type: "storage_changed", collections });
    }
  }
}

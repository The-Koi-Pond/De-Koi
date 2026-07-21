import { useQueries } from "@tanstack/react-query";
import type { StorageEntity } from "../../../engine/capabilities/storage";
import { storageApi } from "../../../shared/api/storage-api";
import { characterKeys } from "../characters/query-keys";
import { lorebookKeys } from "../lorebooks/query-keys";
import { personaKeys } from "../personas/query-keys";
import { presetKeys } from "../presets/query-keys";

const LIBRARY_COLLECTIONS = [
  { entity: "characters", queryKey: characterKeys.presence() },
  { entity: "personas", queryKey: personaKeys.presence },
  { entity: "lorebooks", queryKey: lorebookKeys.presence() },
  { entity: "prompts", queryKey: presetKeys.presence() },
] as const satisfies ReadonlyArray<{ entity: StorageEntity; queryKey: readonly string[] }>;

export interface LibraryPresenceQueryResult {
  data: boolean | undefined;
  isPending: boolean;
  isError: boolean;
}

export type LibraryPresence = {
  status: "loading" | "error" | "empty" | "populated";
  isEmpty: boolean | null;
};

export function libraryPresenceQueryOptions() {
  return LIBRARY_COLLECTIONS.map(({ entity, queryKey }) => ({
    queryKey,
    queryFn: async () => (await storageApi.list<{ id: string }>(entity, { fields: ["id"], limit: 1 })).length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  }));
}

export function deriveLibraryPresence(results: readonly LibraryPresenceQueryResult[]): LibraryPresence {
  if (results.some((result) => result.data === true)) return { status: "populated", isEmpty: false };
  if (results.some((result) => result.isPending)) return { status: "loading", isEmpty: null };
  if (results.some((result) => result.isError || result.data === undefined)) return { status: "error", isEmpty: null };
  return { status: "empty", isEmpty: true };
}

export function useLibraryPresence(): LibraryPresence {
  return deriveLibraryPresence(useQueries({ queries: libraryPresenceQueryOptions() }));
}

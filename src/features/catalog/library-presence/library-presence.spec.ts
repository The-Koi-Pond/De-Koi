import { describe, expect, it, vi } from "vitest";
import { storageApi } from "../../../shared/api/storage-api";
import { presetKeys } from "../presets/query-keys";
import {
  deriveLibraryPresence,
  libraryPresenceQueryOptions,
  type LibraryPresenceQueryResult,
} from "./library-presence";

vi.mock("../../../shared/api/storage-api", () => ({
  storageApi: { list: vi.fn() },
}));

describe("library presence", () => {
  it("reads only one id from each user library collection", async () => {
    vi.mocked(storageApi.list).mockResolvedValue([]);

    const queries = libraryPresenceQueryOptions();
    await Promise.all(queries.map((query) => query.queryFn()));

    expect(storageApi.list).toHaveBeenCalledTimes(4);
    for (const entity of ["characters", "personas", "lorebooks", "prompts"]) {
      expect(storageApi.list).toHaveBeenCalledWith(entity, { fields: ["id"], limit: 1 });
    }
    expect(new Set(queries.map((query) => JSON.stringify(query.queryKey))).size).toBe(4);
    expect(queries.find((query) => query.queryKey[0] === "presets")?.queryKey).toEqual(presetKeys.presence());
    expect(presetKeys.presence().slice(0, presetKeys.all.length)).toEqual(presetKeys.all);
  });

  it("reports empty only after every collection is known empty", () => {
    const empty: LibraryPresenceQueryResult = { data: false, isPending: false, isError: false };
    expect(deriveLibraryPresence([empty, empty, empty, empty])).toEqual({ status: "empty", isEmpty: true });
  });

  it("keeps loading and failed reads unknown instead of claiming empty", () => {
    const empty: LibraryPresenceQueryResult = { data: false, isPending: false, isError: false };
    const loading: LibraryPresenceQueryResult = { data: undefined, isPending: true, isError: false };
    const failed: LibraryPresenceQueryResult = { data: undefined, isPending: false, isError: true };

    expect(deriveLibraryPresence([empty, empty, empty, loading])).toEqual({ status: "loading", isEmpty: null });
    expect(deriveLibraryPresence([empty, empty, empty, failed])).toEqual({ status: "error", isEmpty: null });
  });

  it("reports populated as soon as any collection has an item", () => {
    const empty: LibraryPresenceQueryResult = { data: false, isPending: false, isError: false };
    const populated: LibraryPresenceQueryResult = { data: true, isPending: false, isError: false };
    const failed: LibraryPresenceQueryResult = { data: undefined, isPending: false, isError: true };

    expect(deriveLibraryPresence([empty, populated, empty, failed])).toEqual({ status: "populated", isEmpty: false });
  });
});

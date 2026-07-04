import { describe, expect, it } from "vitest";

import { getStorageCollectionMetadata, type StorageEntity } from "./storage-collections";

describe("storage collection registry memory domains", () => {
  it("exposes canonical memory and index projection collections through the generic API", () => {
    const canonical: StorageEntity = "canonical-memories";
    const projection: StorageEntity = "memory-index-rows";

    expect(getStorageCollectionMetadata(canonical).genericApi).toBe(true);
    expect(getStorageCollectionMetadata(projection).genericApi).toBe(true);
  });
});
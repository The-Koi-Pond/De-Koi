import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-errors";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({ storageApi: storageApiMock }));

import { pluginMemoryApi } from "./plugin-memory-api";

describe("pluginMemoryApi.put", () => {
  beforeEach(() => {
    for (const mock of Object.values(storageApiMock)) mock.mockReset();
    storageApiMock.get.mockResolvedValue(null);
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, value: unknown) => ({ id, value }));
  });

  it("updates the row when another writer created the same key first", async () => {
    storageApiMock.create.mockRejectedValue(new ApiError("plugin-memory/notes:greeting already exists", 400));

    await pluginMemoryApi.put("notes", "greeting", "hello");

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "plugin-memory",
      "notes:greeting",
      expect.objectContaining({ value: "hello" }),
    );
  });

  it("fails on a 400 that is not this key's duplicate create", async () => {
    storageApiMock.create.mockRejectedValue(new ApiError("plugin-memory/notes:other already exists", 400));

    await expect(pluginMemoryApi.put("notes", "greeting", "hello")).rejects.toThrow("notes:other already exists");
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });
});

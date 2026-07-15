import { describe, expect, it, vi } from "vitest";
import { createExtensionStorageApi } from "./extension-storage-api";

describe("extension storage namespace", () => {
  it("uses the host-assigned retained namespace for plugin memory", async () => {
    const storage = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const api = createExtensionStorageApi(storage, "retained-extension");

    await api.create("plugin-memory", { key: "settings", value: { enabled: true } });

    expect(storage.create).toHaveBeenCalledWith("plugin-memory", {
      id: "retained-extension:settings",
      key: "settings",
      pluginId: "retained-extension",
      value: { enabled: true },
    });
  });
});

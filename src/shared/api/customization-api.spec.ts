import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeTauri } from "./tauri-client";
import { extensionsApi, themesApi } from "./customization-api";

vi.mock("./tauri-client", () => ({ invokeTauri: vi.fn() }));

describe("customization API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes active theme selection through one focused command", async () => {
    vi.mocked(invokeTauri).mockResolvedValue({ id: "theme-b" } as never);

    await themesApi.setActive("theme-b");
    await themesApi.setActive(null);

    expect(invokeTauri).toHaveBeenNthCalledWith(1, "theme_set_active", { themeId: "theme-b" });
    expect(invokeTauri).toHaveBeenNthCalledWith(2, "theme_set_active", { themeId: null });
  });

  it("routes extension data lifecycle operations through focused commands", async () => {
    vi.mocked(invokeTauri).mockResolvedValue({} as never);

    await extensionsApi.remove("extension-a", "retain");
    await extensionsApi.retainedData();
    await extensionsApi.reconnect("extension-b", "retained-a");
    await extensionsApi.purgeRetained("retained-a");

    expect(invokeTauri).toHaveBeenNthCalledWith(1, "extension_remove", {
      extensionId: "extension-a",
      dataPolicy: "retain",
    });
    expect(invokeTauri).toHaveBeenNthCalledWith(2, "extension_retained_data_list");
    expect(invokeTauri).toHaveBeenNthCalledWith(3, "extension_reconnect_data", {
      extensionId: "extension-b",
      retentionId: "retained-a",
    });
    expect(invokeTauri).toHaveBeenNthCalledWith(4, "extension_retained_data_purge", {
      retentionId: "retained-a",
    });
  });
});

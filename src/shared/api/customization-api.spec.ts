import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeTauri } from "./tauri-client";
import { themesApi } from "./customization-api";

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
});

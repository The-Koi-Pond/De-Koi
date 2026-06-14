import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportApi } from "./export-api";
import { invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  invokeTauri: vi.fn(),
}));

describe("exportApi.prompt", () => {
  beforeEach(() => {
    vi.mocked(invokeTauri).mockReset();
  });

  it("uses the native preset extension when prompt export returns a raw envelope", async () => {
    vi.mocked(invokeTauri).mockResolvedValue({
      format: "marinara_preset",
      data: { name: "Native Preset" },
    });

    const payload = await exportApi.prompt("preset-1");

    expect(invokeTauri).toHaveBeenCalledWith("prompt_export", { presetId: "preset-1" });
    expect(payload.filename).toBe("preset.marinara.json");
  });
});

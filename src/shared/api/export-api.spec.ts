import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("exportApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ ok: true });
  });

  it("uses De-Koi fallback filenames for native catalog exports", async () => {
    const { exportApi } = await import("./export-api");

    await expect(exportApi.prompt("preset-1")).resolves.toMatchObject({ filename: "preset.dekoi.json" });
    await expect(exportApi.character("character-1")).resolves.toMatchObject({ filename: "character.dekoi.json" });
    await expect(exportApi.persona("persona-1")).resolves.toMatchObject({ filename: "persona.dekoi.json" });
    await expect(exportApi.lorebook("lorebook-1")).resolves.toMatchObject({ filename: "lorebook.dekoi.json" });
  });

  it("keeps compatible single-item exports on plain json filenames", async () => {
    const { exportApi } = await import("./export-api");

    await expect(exportApi.character("character-1", "compatible")).resolves.toMatchObject({ filename: "character.json" });
    await expect(exportApi.persona("persona-1", "compatible")).resolves.toMatchObject({ filename: "persona.json" });
    await expect(exportApi.lorebook("lorebook-1", "compatible")).resolves.toMatchObject({ filename: "lorebook.json" });
  });

  it("uses De-Koi fallback filenames for bulk catalog archives", async () => {
    const { exportApi } = await import("./export-api");

    await expect(exportApi.promptsBulk(["preset-1"])).resolves.toMatchObject({ filename: "de-koi-presets.zip" });
    await expect(exportApi.charactersBulk(["character-1"])).resolves.toMatchObject({
      filename: "de-koi-characters.zip",
    });
    await expect(exportApi.personasBulk(["persona-1"])).resolves.toMatchObject({ filename: "de-koi-personas.zip" });
    await expect(exportApi.lorebooksBulk(["lorebook-1"])).resolves.toMatchObject({ filename: "de-koi-lorebooks.zip" });
  });
});

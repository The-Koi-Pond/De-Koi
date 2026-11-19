import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("imageGenerationApi", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ base64: "image-data", mimeType: "image/png" });
  });

  it("lets the provider-owned timeout bound remote image generation", async () => {
    const { imageGenerationApi } = await import("./image-generation-api");
    const body = {
      connectionId: "image-connection-1",
      prompt: "A moonlit castle",
      width: 1024,
      height: 1024,
    };

    await imageGenerationApi.generate(body);

    expect(mocks.invokeTauri).toHaveBeenCalledWith("image_generate", { body }, { timeoutMs: null });
  });

  it("lets the server bound avatar generation instead of the 30 s hosted limit", async () => {
    const { imageGenerationApi } = await import("./image-generation-api");
    const body = { connectionId: "image-connection-1", appearance: "red scarf" };

    await imageGenerationApi.avatarGenerate(body);

    expect(mocks.invokeTauri).toHaveBeenCalledWith("avatar_generation_command", { body }, { timeoutMs: null });
  });
});

describe("spriteApi", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ sheetBase64: "", cells: [] });
  });

  it("lets the server bound sheet generation and cleanup instead of the 30 s hosted limit", async () => {
    const { spriteApi } = await import("./image-generation-api");
    const body = { connectionId: "image-connection-1", expressions: ["neutral"], cols: 1, rows: 1 };

    await spriteApi.generateSheet(body);
    await spriteApi.cleanup({ cells: [], engine: "auto", cleanupStrength: 35 });

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "sprite_generate_sheet", { body }, { timeoutMs: null });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(
      2,
      "sprite_cleanup",
      { body: { cells: [], engine: "auto", cleanupStrength: 35 } },
      { timeoutMs: null },
    );
  });

  it("keeps the hosted limit for the quick prompt preview", async () => {
    const { spriteApi } = await import("./image-generation-api");

    await spriteApi.generateSheetPreview({ connectionId: "image-connection-1" });

    expect(mocks.invokeTauri).toHaveBeenCalledWith("sprite_generate_sheet_preview", {
      body: { connectionId: "image-connection-1" },
    });
  });
});

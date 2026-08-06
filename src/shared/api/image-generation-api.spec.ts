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
});

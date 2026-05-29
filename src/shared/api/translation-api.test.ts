import { beforeEach, describe, expect, it, vi } from "vitest";
import { translationApi } from "./translation-api";
import { invokeTauri } from "./tauri-client";

vi.mock("./tauri-client", () => ({
  invokeTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invokeTauri);

describe("translationApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("translates text through the translate_text_command payload", async () => {
    const input = {
      text: "bonjour",
      provider: "deeplx" as const,
      targetLanguage: "en",
      connectionId: "connection-1",
      deeplApiKey: "key",
      deeplxUrl: "https://deeplx.example",
    };
    invokeMock.mockResolvedValueOnce({ translatedText: "hello" });

    await expect(translationApi.translateText(input)).resolves.toEqual({ translatedText: "hello" });

    expect(invokeMock).toHaveBeenCalledWith("translate_text_command", { input });
  });

  it("rejects malformed translation responses before callers cache them", async () => {
    invokeMock.mockResolvedValueOnce({ translatedText: null });

    await expect(
      translationApi.translateText({
        text: "bonjour",
        provider: "google",
        targetLanguage: "en",
      }),
    ).rejects.toThrow("Translation response did not include translated text.");
  });
});

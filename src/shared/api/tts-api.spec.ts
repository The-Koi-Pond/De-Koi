import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./tauri-client", () => ({ invokeTauri: (...args: unknown[]) => invoke(...args) }));

const { ttsApi } = await import("./tts-api");

describe("ttsApi.speak", () => {
  it("hands the caller's signal to the request, so a cut-off line stops downloading on the hosted runtime", async () => {
    invoke.mockResolvedValue({ audioBase64: btoa("voice") });
    const controller = new AbortController();
    await ttsApi.speak({ text: "hi" }, controller.signal);
    expect(invoke).toHaveBeenCalledWith("tts_speak", { input: { text: "hi" } }, { signal: controller.signal });
  });
});

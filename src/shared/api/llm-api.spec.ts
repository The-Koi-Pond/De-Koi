import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock("./remote-runtime", () => ({
  cancelRemoteLlmStream: vi.fn(),
  remoteRuntimeTarget: vi.fn(() => null),
  streamRemoteLlm: vi.fn(),
}));

describe("llmApi finite completion", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
  });

  it("allows summary-style completions five minutes on remote runtimes", async () => {
    mocks.invokeTauri.mockResolvedValue({ content: "summary" });
    const { llmApi } = await import("./llm-api");

    await expect(
      llmApi.complete({ connectionId: "nanogpt", messages: [{ role: "user", content: "Summarize this." }] }),
    ).resolves.toBe("summary");

    expect(mocks.invokeTauri).toHaveBeenCalledWith(
      "llm_complete",
      { request: { connectionId: "nanogpt", messages: [{ role: "user", content: "Summarize this." }] } },
      { timeoutMs: 300_000 },
    );
  });
});

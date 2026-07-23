import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("chatCommandApi", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ id: "memory-1" });
  });

  it("routes manual memory creation through the focused chat command", async () => {
    const { chatCommandApi } = await import("./chat-command-api");

    await chatCommandApi.memoryCreate("chat-1", {
      content: "The ferry leaves before dawn.",
    });

    expect(mocks.invokeTauri).toHaveBeenCalledWith("chat_memory_create", {
      chatId: "chat-1",
      body: { content: "The ferry leaves before dawn." },
    });
  });
});

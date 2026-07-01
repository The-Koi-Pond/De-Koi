import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock("./local-file-api", () => ({
  invalidateRemoteManagedAssetObjectUrlsAfter: (value: unknown) => value,
}));

describe("agentApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue([{ id: "run-1" }]);
  });

  it("loads chat-scoped agent runs through the focused command", async () => {
    const { agentApi } = await import("./agent-api");

    await expect(agentApi.listRunsForChat("chat-1")).resolves.toEqual([{ id: "run-1" }]);

    expect(mocks.invokeTauri).toHaveBeenCalledWith("agent_runs_list_for_chat", { chatId: "chat-1" });
  });
});

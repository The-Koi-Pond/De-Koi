import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  invokeRemote: vi.fn(),
  isRemoteCommand: vi.fn(),
  remoteRuntimeTarget: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("./remote-runtime", () => ({
  invokeRemote: mocks.invokeRemote,
  isRemoteCommand: mocks.isRemoteCommand,
  remoteRuntimeTarget: mocks.remoteRuntimeTarget,
}));

describe("invokeTauri performance diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    mocks.invoke.mockReset();
    mocks.invokeRemote.mockReset();
    mocks.isRemoteCommand.mockReset();
    mocks.remoteRuntimeTarget.mockReset();
  });

  it("emits opt-in duration for embedded Tauri IPC calls without argument payloads", async () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.remoteRuntimeTarget.mockReturnValue(null);
    mocks.isRemoteCommand.mockReturnValue(true);
    mocks.invoke.mockResolvedValue({ ok: true });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValueOnce(2).mockReturnValueOnce(9);

    const { invokeTauri } = await import("./tauri-client");

    await expect(invokeTauri("storage_list", { entity: "chats", secret: "not logged" })).resolves.toEqual({
      ok: true,
    });

    expect(info).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "ipc",
      name: "storage_list",
      status: "ok",
      elapsedMs: 7,
      runtime: "embedded",
    });
  });

  it("emits opt-in duration for remote runtime calls", async () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    mocks.remoteRuntimeTarget.mockReturnValue({ baseUrl: "http://127.0.0.1:3080" });
    mocks.isRemoteCommand.mockReturnValue(true);
    mocks.invokeRemote.mockResolvedValue({ ok: true });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValueOnce(20).mockReturnValueOnce(42);

    const { invokeTauri } = await import("./tauri-client");

    await expect(invokeTauri("storage_get", { entity: "chats", id: "chat-1" })).resolves.toEqual({ ok: true });

    expect(info).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "ipc",
      name: "storage_get",
      status: "ok",
      elapsedMs: 22,
      runtime: "remote",
    });
  });

  it("forwards an explicit remote command deadline", async () => {
    mocks.remoteRuntimeTarget.mockReturnValue({ baseUrl: "http://127.0.0.1:3080" });
    mocks.isRemoteCommand.mockReturnValue(true);
    mocks.invokeRemote.mockResolvedValue({ ok: true });

    const { invokeTauri } = await import("./tauri-client");
    await invokeTauri("llm_complete", { request: {} }, { timeoutMs: 300_000 });

    expect(mocks.invokeRemote).toHaveBeenCalledWith(
      "llm_complete",
      { request: {} },
      { timeoutMs: 300_000 },
    );
  });
});

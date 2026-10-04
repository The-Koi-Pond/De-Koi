import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ embedded: true, remote: null as null | { url: string } }));

vi.mock("./tauri-client", () => ({
  hasEmbeddedTauriIpc: () => runtime.embedded,
  invokeTauri: vi.fn(),
}));
vi.mock("./remote-runtime", () => ({ remoteRuntimeTarget: () => runtime.remote }));

import { gameAssetsApi } from "./assets-api";

describe("gameAssetsApi.canOpenFolder", () => {
  beforeEach(() => {
    runtime.embedded = true;
    runtime.remote = null;
  });

  it("allows opening folders in the desktop app on its own data", () => {
    expect(gameAssetsApi.canOpenFolder()).toBe(true);
  });

  it("refuses when the desktop app uses a remote runtime, whose assets live on that server", () => {
    runtime.remote = { url: "http://pi:7860" };
    expect(gameAssetsApi.canOpenFolder()).toBe(false);
  });

  it("refuses in a browser, which has no file manager to open", () => {
    runtime.embedded = false;
    expect(gameAssetsApi.canOpenFolder()).toBe(false);
  });
});

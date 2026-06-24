import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  remoteRuntimeTarget: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock("./remote-runtime", () => ({
  readRemoteError: vi.fn(),
  remoteFetchInit: vi.fn((init) => init),
  remotePrivilegedHeaders: vi.fn(() => ({})),
  remoteRuntimeTarget: mocks.remoteRuntimeTarget,
  streamRemoteFormEvents: vi.fn(),
}));

vi.mock("./local-file-api", () => ({
  invalidateRemoteManagedAssetObjectUrlsAfter: <T>(value: Promise<T>) => value,
}));

describe("profileApi", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.remoteRuntimeTarget.mockReset();
    mocks.remoteRuntimeTarget.mockReturnValue(null);
    mocks.invokeTauri.mockResolvedValue({ ok: true });
  });

  it("uses De-Koi fallback filenames for local profile exports", async () => {
    const { profileApi } = await import("./profile-api");

    await expect(profileApi.exportProfile("native")).resolves.toMatchObject({ filename: "de-koi-profile.json" });
    await expect(profileApi.exportProfile("compatible")).resolves.toMatchObject({
      filename: "de-koi-compatible-export.zip",
    });
    await expect(profileApi.exportProfile("zip")).resolves.toMatchObject({ filename: "de-koi-profile.zip" });
  });
});

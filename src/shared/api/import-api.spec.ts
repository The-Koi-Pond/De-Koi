import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock("./local-file-api", () => ({
  invalidateRemoteManagedAssetObjectUrls: vi.fn(),
  invalidateRemoteManagedAssetObjectUrlsAfter: (request: Promise<unknown>) => request,
}));

describe("importApi request deadlines", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invokeTauri.mockReset();
    mocks.invokeTauri.mockResolvedValue({ success: true });
  });

  it("keeps lorebook imports alive until their durable mutation finishes", async () => {
    const { importApi } = await import("./import-api");
    const envelope = { type: "marinara_lorebook", data: { entries: [] } };
    const stPayload = { entries: {} };
    const file = new File([JSON.stringify(envelope)], "lorebook.dekoi.json", {
      type: "application/json",
    });

    await importApi.marinara(envelope);
    await importApi.marinaraFile(file);
    await importApi.stLorebook(stPayload);

    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(1, "import_marinara", { envelope }, { timeoutMs: null });
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(
      2,
      "import_marinara_file",
      { body: expect.any(Object) },
      { timeoutMs: null },
    );
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(
      3,
      "import_st_lorebook",
      { payload: stPayload },
      { timeoutMs: null },
    );
  });
});

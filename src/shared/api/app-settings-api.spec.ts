import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-errors";
import { transformAppSettings } from "./app-settings-api";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateAppSettingsIfUnchanged: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({ storageApi: storageApiMock }));

describe("transformAppSettings", () => {
  beforeEach(() => {
    for (const mock of Object.values(storageApiMock)) mock.mockReset();
  });

  it("re-applies the change on top of a write that landed first", async () => {
    storageApiMock.get
      .mockResolvedValueOnce({ id: "row", value: { a: 1 } })
      .mockResolvedValueOnce({ id: "row", value: { a: 1, b: 2 } });
    storageApiMock.updateAppSettingsIfUnchanged
      .mockResolvedValueOnce({ updated: false })
      .mockResolvedValueOnce({ updated: true });

    const written = await transformAppSettings("row", "test settings", (value) => ({
      ...(value as object),
      c: 3,
    }));

    expect(written).toEqual({ a: 1, b: 2, c: 3 });
    expect(storageApiMock.updateAppSettingsIfUnchanged).toHaveBeenLastCalledWith("row", { a: 1, b: 2 }, written);
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("gives up after a bounded number of lost writes", async () => {
    storageApiMock.get.mockResolvedValue({ id: "row", value: {} });
    storageApiMock.updateAppSettingsIfUnchanged.mockResolvedValue({ updated: false });

    await expect(transformAppSettings("row", "test settings", () => ({ c: 3 }))).rejects.toThrow(
      "Test settings kept changing while saving. Try again.",
    );
    expect(storageApiMock.updateAppSettingsIfUnchanged).toHaveBeenCalledTimes(5);
  });

  it("creates a missing row, and applies on top of a row another client created first", async () => {
    storageApiMock.get.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "row", value: { a: 1 } });
    storageApiMock.create.mockRejectedValueOnce(new ApiError("app-settings/row already exists", 400));
    storageApiMock.updateAppSettingsIfUnchanged.mockResolvedValueOnce({ updated: true });

    const written = await transformAppSettings("row", "test settings", (value, exists) => ({
      ...(exists ? (value as object) : {}),
      c: 3,
    }));

    expect(written).toEqual({ a: 1, c: 3 });
  });

  it("refuses on a runtime without conditional updates instead of writing plainly", async () => {
    storageApiMock.get.mockResolvedValue({ id: "row", value: {} });
    storageApiMock.updateAppSettingsIfUnchanged.mockRejectedValue(
      new Error("app_settings_update_if_unchanged is not exposed by the remote runtime"),
    );

    await expect(transformAppSettings("row", "test settings", () => ({ c: 3 }))).rejects.toThrow(
      "This De-Koi server is older than the app and cannot save test settings safely. Update and restart the server, then try again.",
    );
    expect(storageApiMock.update).not.toHaveBeenCalled();
    expect(storageApiMock.create).not.toHaveBeenCalled();
  });
});

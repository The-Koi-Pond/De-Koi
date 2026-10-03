import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversationSettingsApi } from "./conversation-settings-api";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    updateAppSettingsIfUnchanged: vi.fn(),
  },
}));

vi.mock("./storage-api", () => ({
  storageApi: storageApiMock,
}));

describe("conversationSettingsApi", () => {
  beforeEach(() => {
    storageApiMock.create.mockReset();
    storageApiMock.get.mockReset();
    storageApiMock.update.mockReset();
    storageApiMock.updateAppSettingsIfUnchanged.mockReset();
  });

  it("returns disabled defaults when no conversation settings record exists", async () => {
    storageApiMock.get.mockResolvedValue(null);

    await expect(conversationSettingsApi.settings.get()).resolves.toEqual({
      statusMessagesEnabledByDefault: false,
    });
  });

  it("creates the conversation settings record when saving the global status default", async () => {
    storageApiMock.get.mockResolvedValue(null);

    await expect(conversationSettingsApi.settings.setStatusMessagesEnabledByDefault(true)).resolves.toEqual({
      statusMessagesEnabledByDefault: true,
    });

    expect(storageApiMock.create).toHaveBeenCalledWith("app-settings", {
      id: "conversation",
      value: { statusMessagesEnabledByDefault: true },
    });
  });

  it("changes an existing record with a compare-and-set write, never a plain update", async () => {
    storageApiMock.get.mockResolvedValue({ id: "conversation", value: { statusMessagesEnabledByDefault: false } });
    storageApiMock.updateAppSettingsIfUnchanged.mockResolvedValue({ updated: true });

    await expect(conversationSettingsApi.settings.setStatusMessagesEnabledByDefault(true)).resolves.toEqual({
      statusMessagesEnabledByDefault: true,
    });

    expect(storageApiMock.updateAppSettingsIfUnchanged).toHaveBeenCalledWith(
      "conversation",
      { statusMessagesEnabledByDefault: false },
      { statusMessagesEnabledByDefault: true },
    );
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("refuses to save on a server without conditional settings updates", async () => {
    storageApiMock.get.mockResolvedValue({ id: "conversation", value: { statusMessagesEnabledByDefault: false } });
    storageApiMock.updateAppSettingsIfUnchanged.mockRejectedValue(
      new Error("app_settings_update_if_unchanged is not exposed by the remote runtime"),
    );

    await expect(conversationSettingsApi.settings.setStatusMessagesEnabledByDefault(true)).rejects.toThrow(
      "cannot save conversation settings safely",
    );
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("only changes settings through operations that are re-applied after a conflict", () => {
    // A whole-object save would retry with a stale snapshot and undo a
    // concurrent change, so there is none.
    expect(Object.keys(conversationSettingsApi.settings).sort()).toEqual(["get", "setStatusMessagesEnabledByDefault"]);
  });
});

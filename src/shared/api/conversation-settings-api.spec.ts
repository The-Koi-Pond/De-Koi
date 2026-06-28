import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversationSettingsApi } from "./conversation-settings-api";

const { storageApiMock } = vi.hoisted(() => ({
  storageApiMock: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
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
});

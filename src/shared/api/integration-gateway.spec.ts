import { beforeEach, describe, expect, it, vi } from "vitest";

const coreModulesGet = vi.fn();
const invokeTauri = vi.fn();

vi.mock("./core-modules-api", () => ({
  coreModulesApi: {
    settings: {
      get: coreModulesGet,
    },
  },
}));

vi.mock("./tauri-client", () => ({
  invokeTauri,
}));

describe("integrationGateway Discord mirror", () => {
  beforeEach(() => {
    coreModulesGet.mockReset();
    invokeTauri.mockReset();
  });

  it("does not send Discord webhooks while the Discord Mirror module is disabled", async () => {
    const { integrationGateway } = await import("./integration-gateway");

    coreModulesGet.mockResolvedValue({ enabled: {} });

    await integrationGateway.discord?.mirrorMessage({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      content: "Hello",
      username: "Narrator",
    });

    expect(invokeTauri).not.toHaveBeenCalled();
  });
  it("sends Discord webhooks while the Discord Mirror module is enabled", async () => {
    const { DISCORD_MIRROR_MODULE_ID } = await import("../../engine/contracts/constants/core-modules");
    const { integrationGateway } = await import("./integration-gateway");

    coreModulesGet.mockResolvedValue({ enabled: { [DISCORD_MIRROR_MODULE_ID]: true } });

    await integrationGateway.discord?.mirrorMessage({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      content: "Hello",
      username: "Narrator",
    });

    expect(invokeTauri).toHaveBeenCalledWith("discord_webhook_send", {
      body: {
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        content: "Hello",
        username: "Narrator",
      },
    });
  });
});

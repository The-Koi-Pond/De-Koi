import { beforeEach, describe, expect, it, vi } from "vitest";

import { DISCORD_MIRROR_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { integrationGateway } from "./integration-gateway";

const { coreModulesGet, invokeTauri } = vi.hoisted(() => ({
  coreModulesGet: vi.fn(),
  invokeTauri: vi.fn(),
}));

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
    coreModulesGet.mockResolvedValue({ enabled: {} });

    await integrationGateway.discord?.mirrorMessage({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      content: "Hello",
      username: "Narrator",
    });

    expect(invokeTauri).not.toHaveBeenCalled();
  });
  it("sends Discord webhooks while the Discord Mirror module is enabled", async () => {
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

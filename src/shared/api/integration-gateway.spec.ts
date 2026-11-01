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

describe("integrationGateway Spotify source", () => {
  beforeEach(() => {
    invokeTauri.mockReset();
  });

  function answer(settings: { source: string }, status: { connected: boolean }) {
    invokeTauri.mockImplementation(async (command: string) => (command === "music_settings" ? settings : status));
  }

  it("is ready only when Spotify is the source and an account is connected", async () => {
    const spotify = integrationGateway.music?.spotify;
    answer({ source: "spotify" }, { connected: true });
    await expect(spotify?.isReady()).resolves.toBe(true);
    expect(invokeTauri).toHaveBeenCalledWith("music_status", { body: { provider: "spotify" } });

    answer({ source: "youtube" }, { connected: true });
    await expect(spotify?.isReady()).resolves.toBe(false);
    answer({ source: "spotify" }, { connected: false });
    await expect(spotify?.isReady()).resolves.toBe(false);
  });

  it("finds a track by title and artist and plays it through the Spotify provider", async () => {
    const track = { provider: "spotify", id: "spotify:track:abc", title: "Song" };
    invokeTauri.mockResolvedValueOnce({ candidates: [track], track });
    await expect(integrationGateway.music?.spotify?.findTrack({ title: "Song", artist: "Band" })).resolves.toEqual(
      track,
    );
    expect(invokeTauri).toHaveBeenCalledWith("music_search_candidates", {
      input: { provider: "spotify", match: { title: "Song", artist: "Band" } },
    });

    invokeTauri.mockResolvedValueOnce({ state: "playing" });
    await integrationGateway.music?.spotify?.playOnRepeat({ track, volume: 40 });
    expect(invokeTauri).toHaveBeenLastCalledWith("music_play", { body: { provider: "spotify", track, volume: 40 } });
  });
});

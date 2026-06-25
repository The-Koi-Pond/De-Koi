import { describe, expect, it } from "vitest";
import {
  DISCORD_MIRROR_MODULE_ID,
  SPOTIFY_MINI_PLAYER_MODULE_ID,
} from "../../../../engine/contracts/constants/core-modules";
import { coreModuleViews, isCoreModuleEnabled } from "./core-module-registry";

describe("core module registry", () => {
  it("registers the Spotify mini player as a bundled opt-in module", () => {
    const modules = coreModuleViews({ enabled: {} });

    const spotifyModule = modules.find((module) => module.id === SPOTIFY_MINI_PLAYER_MODULE_ID);

    expect(spotifyModule).toMatchObject({
      id: SPOTIFY_MINI_PLAYER_MODULE_ID,
      name: "Spotify Mini Player",
      slug: "spotify-mini-player",
      enabled: false,
      status: "disabled",
      source: "core",
      runtime: "Desktop title-bar player and mobile floating widget",
    });
  });

  it("enables the Spotify mini player from core module settings", () => {
    expect(isCoreModuleEnabled(SPOTIFY_MINI_PLAYER_MODULE_ID, { enabled: {} })).toBe(false);
    expect(
      isCoreModuleEnabled(SPOTIFY_MINI_PLAYER_MODULE_ID, { enabled: { [SPOTIFY_MINI_PLAYER_MODULE_ID]: true } }),
    ).toBe(true);
  });

  it("registers Discord Mirror as a bundled opt-in module", () => {
    const modules = coreModuleViews({ enabled: {} });

    const discordModule = modules.find((module) => module.id === DISCORD_MIRROR_MODULE_ID);

    expect(discordModule).toMatchObject({
      id: DISCORD_MIRROR_MODULE_ID,
      name: "Discord Mirror",
      slug: "discord-mirror",
      enabled: false,
      status: "disabled",
      source: "core",
      runtime: "Chat and game message webhook mirror",
    });
  });
});

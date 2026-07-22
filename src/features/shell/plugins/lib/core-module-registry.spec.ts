import { describe, expect, it } from "vitest";
import {
  DISCORD_MIRROR_MODULE_ID,
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
  SPOTIFY_MINI_PLAYER_MODULE_ID,
} from "../../../../engine/contracts/constants/core-modules";
import { coreModuleViews, isCoreModuleEnabled } from "./core-module-registry";

describe("core module registry", () => {
  it("registers the Music Player as a bundled opt-in module", () => {
    const modules = coreModuleViews({ enabled: {} });

    const musicModule = modules.find((module) => module.id === MUSIC_DJ_MINI_PLAYER_MODULE_ID);

    expect(musicModule).toMatchObject({
      id: MUSIC_DJ_MINI_PLAYER_MODULE_ID,
      name: "Music Player",
      slug: "music-dj-mini-player",
      enabled: false,
      status: "disabled",
      source: "core",
      runtime: "Desktop title-bar player and mobile floating widget",
    });
    expect(musicModule?.description).toContain("automatic scene-aware picks in roleplay");
    expect(musicModule?.description).toContain("fresh pick at any time");
    expect(musicModule?.description).not.toMatch(/YouTube-first/i);
    expect(modules.some((module) => module.id === LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID)).toBe(false);
    expect(SPOTIFY_MINI_PLAYER_MODULE_ID).toBe(MUSIC_DJ_MINI_PLAYER_MODULE_ID);
  });

  it("enables the Music Player from current and legacy module settings", () => {
    expect(isCoreModuleEnabled(MUSIC_DJ_MINI_PLAYER_MODULE_ID, { enabled: {} })).toBe(false);
    expect(
      isCoreModuleEnabled(MUSIC_DJ_MINI_PLAYER_MODULE_ID, {
        enabled: { [MUSIC_DJ_MINI_PLAYER_MODULE_ID]: true },
      }),
    ).toBe(true);
    expect(
      isCoreModuleEnabled(MUSIC_DJ_MINI_PLAYER_MODULE_ID, {
        enabled: { [LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID]: true },
      }),
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

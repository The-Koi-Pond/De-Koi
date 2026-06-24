import { describe, expect, it } from "vitest";
import { SPOTIFY_MINI_PLAYER_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { settingsFromLegacyUiStorageValue } from "./core-modules-api";

describe("coreModulesApi legacy settings migration", () => {
  it("enables the Spotify mini player when the legacy UI setting was enabled", () => {
    const migrated = settingsFromLegacyUiStorageValue(
      JSON.stringify({
        state: {
          spotifyPlayerEnabled: true,
        },
        version: 10,
      }),
    );

    expect(migrated).toEqual({
      enabled: {
        [SPOTIFY_MINI_PLAYER_MODULE_ID]: true,
      },
    });
  });

  it("ignores missing, disabled, or malformed legacy UI settings", () => {
    expect(settingsFromLegacyUiStorageValue(null)).toEqual({ enabled: {} });
    expect(settingsFromLegacyUiStorageValue("{")).toEqual({ enabled: {} });
    expect(settingsFromLegacyUiStorageValue(JSON.stringify({ state: { spotifyPlayerEnabled: false } }))).toEqual({
      enabled: {},
    });
  });
});

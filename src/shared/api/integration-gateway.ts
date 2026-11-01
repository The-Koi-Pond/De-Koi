import type { IntegrationGateway } from "../../engine/capabilities/integrations";
import {
  DISCORD_MIRROR_MODULE_ID,
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
} from "../../engine/contracts/constants/core-modules";
import { coreModulesApi } from "./core-modules-api";
import { imageGenerationApi } from "./image-generation-api";
import { lorebookCommandApi } from "./lorebook-command-api";
import { type MusicCandidate, musicApi, spotifyMusicApi } from "./music-api";
import { invokeTauri } from "./tauri-client";
import { webResearchApi } from "./web-research-api";

async function discordMirrorModuleEnabled(): Promise<boolean> {
  try {
    const settings = await coreModulesApi.settings.get();
    return settings.enabled[DISCORD_MIRROR_MODULE_ID] === true;
  } catch (error) {
    console.warn("[integrations] Discord mirror skipped: core module settings unavailable", error);
    return false;
  }
}

async function musicPlayerModuleEnabled(): Promise<boolean> {
  try {
    const settings = await coreModulesApi.settings.get();
    return (
      settings.enabled[MUSIC_DJ_MINI_PLAYER_MODULE_ID] ??
      settings.enabled[LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID] ??
      false
    );
  } catch (error) {
    console.warn("[integrations] Music Player automation skipped: core module settings unavailable", error);
    return false;
  }
}

async function spotifySourceReady(): Promise<boolean> {
  try {
    const [settings, status] = await Promise.all([musicApi.settings(), spotifyMusicApi.status()]);
    return settings.source === "spotify" && status.connected;
  } catch (error) {
    console.warn("[integrations] Spotify source unavailable", error);
    return false;
  }
}

export const integrationGateway: IntegrationGateway = {
  lorebooks: {
    vectorizeEntries: (lorebookId, entryIds) =>
      lorebookCommandApi.vectorize(lorebookId, { onlyMissing: true, entryIds }),
  },
  webResearch: {
    search: (input) => webResearchApi.search(input),
    readPage: (input) => webResearchApi.readPage(input),
  },
  music: {
    isEnabled: musicPlayerModuleEnabled,
    status: (input) => musicApi.status(input),
    searchCandidates: (input) => musicApi.searchCandidates(input),
    play: (input) => musicApi.play(input),
    pause: (input) => musicApi.pause(input),
    stop: (input) => musicApi.stop(input),
    setVolume: (input) => musicApi.setVolume(input),
    freshPick: (input) => musicApi.freshPick(input),
    spotify: {
      isReady: spotifySourceReady,
      findTrack: async <T = unknown>(input: { title: string; artist: string }) =>
        (await spotifyMusicApi.findTrack(input)).track as T,
      playOnRepeat: <T = unknown>(input: { track: unknown; volume?: number | null }) =>
        spotifyMusicApi.play({ track: input.track as MusicCandidate, volume: input.volume }) as Promise<T>,
    },
  },
  customTools: {
    execute: <T = unknown>(input: { toolName: string; arguments: unknown }) =>
      invokeTauri<T>("custom_tool_execute", { body: input }),
  },
  image: {
    generate: (input) => imageGenerationApi.generate(input),
  },
  discord: {
    mirrorMessage: async <T = unknown>(input: {
      webhookUrl: string;
      content: string;
      username?: string | null;
      avatarUrl?: string | null;
    }) => {
      if (!(await discordMirrorModuleEnabled())) return undefined as T;
      return invokeTauri<T>("discord_webhook_send", { body: input });
    },
  },
};

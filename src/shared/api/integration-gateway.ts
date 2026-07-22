import type { IntegrationGateway } from "../../engine/capabilities/integrations";
import {
  DISCORD_MIRROR_MODULE_ID,
  LEGACY_SPOTIFY_MINI_PLAYER_MODULE_ID,
  MUSIC_DJ_MINI_PLAYER_MODULE_ID,
} from "../../engine/contracts/constants/core-modules";
import { coreModulesApi } from "./core-modules-api";
import { imageGenerationApi } from "./image-generation-api";
import { spotifyApi } from "./integration-utility-api";
import { musicApi } from "./music-api";
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

export const integrationGateway: IntegrationGateway = {
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
  },
  spotify: {
    player: (input) => spotifyApi.player(input),
    playlists: (input) =>
      spotifyApi.playlists({
        agentId: input.agentId,
        limit: input.limit ?? undefined,
      }),
    playlistTracks: (input) => spotifyApi.playlistTracks(input),
    searchTracks: (input) => spotifyApi.searchTracks(input),
    playTrack: <T = unknown>(input: Record<string, unknown>) => spotifyApi.playTrack(input) as Promise<T>,
    play: <T = unknown>(input: Record<string, unknown>) => spotifyApi.play(input) as Promise<T>,
    volume: <T = unknown>(input: Record<string, unknown>) => spotifyApi.volume(input) as Promise<T>,
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

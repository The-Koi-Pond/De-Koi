import type { IntegrationGateway } from "../../engine/capabilities/integrations";
import { DISCORD_MIRROR_MODULE_ID } from "../../engine/contracts/constants/core-modules";
import { coreModulesApi } from "./core-modules-api";
import { imageGenerationApi } from "./image-generation-api";
import { musicDjApi } from "./music-dj-api";
import { spotifyApi } from "./integration-utility-api";
import { invokeTauri } from "./tauri-client";

async function discordMirrorModuleEnabled(): Promise<boolean> {
  try {
    const settings = await coreModulesApi.settings.get();
    return settings.enabled[DISCORD_MIRROR_MODULE_ID] === true;
  } catch (error) {
    console.warn("[integrations] Discord mirror skipped: core module settings unavailable", error);
    return false;
  }
}

export const integrationGateway: IntegrationGateway = {
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
  musicDj: {
    status: <T = unknown>() => musicDjApi.status() as Promise<T>,
    resolve: <T = unknown>(input: Record<string, unknown>) => musicDjApi.resolve(input as never) as Promise<T>,
    feedback: <T = unknown>(input: Record<string, unknown>) => musicDjApi.feedback(input as never) as Promise<T>,
  },
  customTools: {
    execute: <T = unknown>(input: { toolName: string; arguments: unknown }) =>
      invokeTauri<T>("custom_tool_execute", { body: input }),
  },
  image: {
    generate: <T = unknown>(input: Record<string, unknown>) => imageGenerationApi.generate<T>(input),
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

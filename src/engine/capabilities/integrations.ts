export interface SpotifyGateway {
  player<T = unknown>(input: { agentId?: string | null }): Promise<T>;
  playlists<T = unknown>(input: { agentId?: string | null; limit?: number | null }): Promise<T>;
  playlistTracks<T = unknown>(input: Record<string, unknown>): Promise<T>;
  searchTracks<T = unknown>(input: Record<string, unknown>): Promise<T>;
  playTrack<T = unknown>(input: Record<string, unknown>): Promise<T>;
  play<T = unknown>(input: Record<string, unknown>): Promise<T>;
  volume<T = unknown>(input: Record<string, unknown>): Promise<T>;
}

export interface MusicGateway {
  isEnabled?(): Promise<boolean>;
  status<T = unknown>(input?: Record<string, unknown>): Promise<T>;
  searchCandidates<T = unknown>(input: Record<string, unknown>): Promise<T>;
  play<T = unknown>(input: Record<string, unknown>): Promise<T>;
  pause<T = unknown>(input?: Record<string, unknown>): Promise<T>;
  stop<T = unknown>(input?: Record<string, unknown>): Promise<T>;
  setVolume<T = unknown>(input: { volume: number }): Promise<T>;
  freshPick<T = unknown>(input: Record<string, unknown>): Promise<T>;
}

export interface CustomToolsGateway {
  execute<T = unknown>(input: { toolName: string; arguments: unknown }): Promise<T>;
}

export interface ImageGenerationGateway {
  generate(input: Record<string, unknown>): Promise<GeneratedImageResult>;
}

export interface DiscordGateway {
  mirrorMessage<T = unknown>(input: {
    webhookUrl: string;
    content: string;
    username?: string | null;
    avatarUrl?: string | null;
  }): Promise<T>;
}

export interface WebResearchGateway {
  search<T = unknown>(input: { chatId: string; grantId: string; query: string; maxResults?: number }): Promise<T>;
  readPage<T = unknown>(input: { chatId: string; grantId: string; query: string; url: string }): Promise<T>;
}

export interface IntegrationGateway {
  music?: MusicGateway;
  spotify: SpotifyGateway;
  customTools: CustomToolsGateway;
  image: ImageGenerationGateway;
  discord?: DiscordGateway;
  webResearch?: WebResearchGateway;
}
import type { GeneratedImageResult } from "../contracts/generated-image";

export interface SpotifyGateway {
  playbackAvailable(): Promise<boolean>;
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

export interface LorebookCommandsGateway {
  /** Embed these entries of a lorebook (skipping ones already current). */
  vectorizeEntries<T = unknown>(lorebookId: string, entryIds: string[]): Promise<T>;
}

/** A voice note's audio, kept as a managed file of its chat. */
export interface VoiceNoteFile {
  url: string;
  filename: string;
  contentType: string;
}

export interface VoiceNoteGateway {
  /** Whether Text to Speech is set up, so a voice note can be made. */
  available(): Promise<boolean>;
  /** Speak `text` in the character's Text to Speech voice and keep the audio with the chat. */
  create(input: { chatId: string; text: string; speaker: string; characterId: string }): Promise<VoiceNoteFile>;
}

export interface IntegrationGateway {
  music?: MusicGateway;
  spotify: SpotifyGateway;
  customTools: CustomToolsGateway;
  image: ImageGenerationGateway;
  discord?: DiscordGateway;
  webResearch?: WebResearchGateway;
  lorebooks?: LorebookCommandsGateway;
  voiceNotes?: VoiceNoteGateway;
}
import type { GeneratedImageResult } from "../contracts/generated-image";

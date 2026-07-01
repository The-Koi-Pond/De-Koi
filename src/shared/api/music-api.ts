import { invokeTauri } from "./tauri-client";

export type MusicProvider = "youtube" | "spotify" | "local" | (string & {});

export interface MusicCandidate {
  provider: MusicProvider;
  id: string;
  title: string;
  channelOrArtist?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
  confidence?: number | null;
  reasonTags?: string[];
}

export interface MusicStatus {
  provider: MusicProvider;
  enabled: boolean;
  requiresSetup: boolean;
  powerModeAvailable: boolean;
  iframeFallbackAvailable: boolean;
  searchBackend?: string | null;
  legacyProviders?: string[];
}

export interface MusicProviderError {
  code: string;
  message: string;
}

export interface MusicCandidateResponse {
  provider: MusicProvider;
  candidates: MusicCandidate[];
  requiresSetup: boolean;
  powerModeAvailable: boolean;
  iframeFallbackAvailable: boolean;
  source?: string | null;
  providerError?: MusicProviderError | null;
}

export interface MusicPlaybackState {
  provider: MusicProvider;
  state: "playing" | "paused" | "stopped" | "volume" | string;
  mode?: "iframe" | "power" | string;
  powerModeAvailable?: boolean;
  iframeFallbackAvailable?: boolean;
  track?: MusicCandidate | null;
  volume?: number | null;
}

export const musicApi = {
  status<T = MusicStatus>(body?: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_status", { body: body ?? null });
  },
  searchCandidates<T = MusicCandidateResponse>(input: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_search_candidates", { input });
  },
  play<T = MusicPlaybackState>(body: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_play", { body });
  },
  pause<T = MusicPlaybackState>(body?: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_pause", { body: body ?? null });
  },
  stop<T = MusicPlaybackState>(body?: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_stop", { body: body ?? null });
  },
  setVolume<T = MusicPlaybackState>(body: { volume: number }): Promise<T> {
    return invokeTauri<T>("music_set_volume", { body });
  },
  freshPick<T = MusicCandidateResponse>(input: Record<string, unknown>): Promise<T> {
    return invokeTauri<T>("music_fresh_pick", { input });
  },
};

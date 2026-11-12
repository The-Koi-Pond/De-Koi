import { invokeTauri } from "./tauri-client";

type MusicProvider = "youtube" | "spotify" | "local" | (string & {});

export interface MusicCandidate {
  provider: MusicProvider;
  id: string;
  title: string;
  channelOrArtist?: string | null;
  /** Spotify only. */
  album?: string | null;
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

interface MusicProviderError {
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

export type MusicPlayerSource = "youtube" | "spotify";

/** Music Player settings stored on the server (`app-settings` row `music-player`). */
export interface MusicPlayerSettings {
  source: MusicPlayerSource;
  spotifyClientId: string;
  spotifyPreferredDeviceId: string | null;
  spotifyPreferredDeviceName: string | null;
  /** The redirect URI to register in the user's Spotify developer app. */
  spotifyRedirectUri: string;
}

export interface MusicPlayerSettingsUpdate {
  source?: MusicPlayerSource;
  /** An empty string clears it. A different Client ID disconnects the current sign-in. */
  spotifyClientId?: string;
  spotifyPreferredDeviceId?: string | null;
  spotifyPreferredDeviceName?: string | null;
}

export interface SpotifyStatus extends MusicStatus {
  provider: "spotify";
  /** Spotify is the Music Player source. */
  selected: boolean;
  clientId: string;
  hasClientId: boolean;
  /** A refresh token is stored. */
  connected: boolean;
  /** Connected, and the access token has expired; it renews on the next call. */
  renewsAutomatically: boolean;
  displayName: string | null;
  grantedScopes: string[];
  missingScopes: string[];
  redirectUri: string;
}

export interface SpotifySignInStart {
  provider: "spotify";
  signInId: string;
  /** Open this in the browser. */
  authUrl: string;
  redirectUri: string;
  expiresInMs: number;
  /** True when this machine listens on the redirect URI for the callback. */
  localListener: boolean;
}

export type SpotifySignInStatus =
  { status: "waiting"; expiresInMs: number } | { status: "done" } | { status: "failed"; message: string };

export interface SpotifyPlaylist {
  id: string;
  name: string;
  ownerName: string | null;
  trackCount: number | null;
  image: string | null;
  /** False for playlists Spotify won't let De-Koi read; show "(can't be read)" and don't offer them. */
  readable: boolean;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  supportsVolume: boolean;
  volumePercent: number | null;
}

/** Where a chat's Spotify candidates come from. A playlist or artist without its value means Liked Songs. */
export type SpotifySourceChoice =
  | { type: "liked" }
  | { type: "playlist"; playlistId: string; playlistName?: string | null }
  | { type: "artist"; artist: string }
  | { type: "anything" };

/** A recent-history entry; plain strings are read as Spotify track URIs. */
export type MusicRecentTrack = { provider: MusicProvider; id: string } | string;

export interface SpotifyCueInput {
  source?: SpotifySourceChoice | null;
  query?: string | null;
  mood?: string | null;
  setting?: string | null;
  constraints?: string[] | null;
  /** Avoided when other candidates exist. */
  recentIds?: MusicRecentTrack[] | null;
  /** With `fresh`, never offered. */
  currentTrackId?: string | null;
  fresh?: boolean;
  /** Capped at 50 for Liked Songs and playlists, 20 for artist and Anything. */
  limit?: number;
}

export interface SpotifyPlayInput {
  /** A Spotify candidate; its `id` is the track URI. */
  track: MusicCandidate;
  volume?: number | null;
}

export interface SpotifyPlaybackResult extends MusicPlaybackState {
  provider: "spotify";
  /** `accepted`: Spotify took the request but the device didn't confirm it; show `message`. */
  state: "playing" | "accepted";
  confirmed: boolean;
  device: SpotifyDevice;
  /** "Spotify accepted the track; waiting for <device>." and/or the volume-control message. */
  message: string | null;
}

export interface SpotifyPlaybackState extends MusicPlaybackState {
  provider: "spotify";
  state: "playing" | "paused" | "stopped";
  device: SpotifyDevice | null;
  repeat?: string | null;
  progressSeconds?: number | null;
}

const SPOTIFY = { provider: "spotify" } as const;

export const spotifyMusicApi = {
  status: () => invokeTauri<SpotifyStatus>("music_status", { body: SPOTIFY }),
  /** Saves `clientId` first when given. */
  startSignIn: (clientId?: string) =>
    invokeTauri<SpotifySignInStart>("music_sign_in_start", {
      body: clientId === undefined ? SPOTIFY : { ...SPOTIFY, clientId },
    }),
  signInStatus: (signInId: string) =>
    invokeTauri<SpotifySignInStatus>("music_sign_in_status", { body: { ...SPOTIFY, signInId } }),
  /** Paste-back: the full address the browser was sent to. */
  finishSignIn: (callbackUrl: string) =>
    invokeTauri<SpotifyStatus>("music_sign_in_finish", { body: { ...SPOTIFY, callbackUrl } }),
  disconnect: () => invokeTauri<SpotifyStatus>("music_disconnect", { body: SPOTIFY }),
  playlists: () =>
    invokeTauri<{ provider: "spotify"; playlists: SpotifyPlaylist[] }>("music_playlists", { body: SPOTIFY }),
  devices: () => invokeTauri<{ provider: "spotify"; devices: SpotifyDevice[] }>("music_devices", { body: SPOTIFY }),
  candidates: (input: SpotifyCueInput) =>
    invokeTauri<MusicCandidateResponse>("music_search_candidates", { input: { ...input, ...SPOTIFY } }),
  freshPick: (input: SpotifyCueInput) =>
    invokeTauri<MusicCandidateResponse>("music_fresh_pick", { input: { ...input, ...SPOTIFY } }),
  /** Best catalogue match for the `[spotify: …]` command; fails with "Spotify didn't find …". */
  findTrack: (match: { title: string; artist: string }) =>
    invokeTauri<MusicCandidateResponse & { track: MusicCandidate }>("music_search_candidates", {
      input: { ...SPOTIFY, match },
    }),
  /** Plays on repeat on the chosen device. */
  play: (input: SpotifyPlayInput) =>
    invokeTauri<SpotifyPlaybackResult>("music_play", { body: { ...SPOTIFY, ...input } }),
  pause: (deviceId?: string | null) =>
    invokeTauri<MusicPlaybackState>("music_pause", { body: { ...SPOTIFY, deviceId: deviceId ?? null } }),
  resume: (deviceId?: string | null) =>
    invokeTauri<MusicPlaybackState>("music_resume", { body: { ...SPOTIFY, deviceId: deviceId ?? null } }),
  stop: (deviceId?: string | null) =>
    invokeTauri<MusicPlaybackState>("music_stop", { body: { ...SPOTIFY, deviceId: deviceId ?? null } }),
  setVolume: (volume: number, deviceId?: string | null) =>
    invokeTauri<MusicPlaybackState>("music_set_volume", { body: { ...SPOTIFY, volume, deviceId: deviceId ?? null } }),
  playbackState: () => invokeTauri<SpotifyPlaybackState>("music_playback_state", { body: SPOTIFY }),
};

export const musicApi = {
  settings: () => invokeTauri<MusicPlayerSettings>("music_settings"),
  updateSettings: (patch: MusicPlayerSettingsUpdate) =>
    invokeTauri<MusicPlayerSettings>("music_update_settings", { body: patch }),
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

export type MusicDjProvider = "youtube" | "spotify-legacy";
export type MusicDjMode = "conversation" | "roleplay" | "game" | "visual_novel";
export type MusicDjPlaylistOwnerType = "character" | "chat" | "global";
export type MusicDjFeedbackAction = "play" | "skip" | "like" | "dislike";

export interface MusicDjCharacterContext {
  id: string;
  name: string;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
}

export interface MusicDjPersonaContext {
  id?: string | null;
  name: string;
  description?: string | null;
  personality?: string | null;
}

export interface MusicDjIntentHints {
  mood?: string | null;
  energy?: "low" | "medium" | "high" | null;
  vocals?: "instrumental" | "vocals" | "either" | null;
  duration?: "song" | "ambience" | "long_mix" | null;
  genre?: string | null;
  sceneType?: string | null;
}

export interface MusicDjIntent {
  provider: MusicDjProvider;
  mode: MusicDjMode;
  sceneText: string;
  activeCharacterIds?: string[];
  characters?: MusicDjCharacterContext[];
  persona?: MusicDjPersonaContext | null;
  hints?: MusicDjIntentHints;
  sourceConstraints?: Record<string, unknown> | null;
  avoidVideoIds?: string[];
}

export interface MusicDjTrack {
  provider: MusicDjProvider;
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnailUrl: string;
  score: number;
  reason: string;
}

export interface MusicDjResolveResponse {
  available: boolean;
  provider: MusicDjProvider;
  tracks: MusicDjTrack[];
  error?: string | null;
}

export interface MusicDjPlaylist {
  id: string;
  ownerType: MusicDjPlaylistOwnerType;
  ownerId: string;
  name: string;
  provider: MusicDjProvider;
  tracks: MusicDjTrack[];
  createdAt: string;
  updatedAt: string;
}

export interface MusicDjFeedbackInput {
  provider: MusicDjProvider;
  action: MusicDjFeedbackAction;
  track?: MusicDjTrack | null;
  videoId?: string | null;
  chatId?: string | null;
  characterId?: string | null;
}

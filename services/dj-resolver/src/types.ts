export type MusicDjProvider = "youtube" | "spotify-legacy";
export type MusicDjMode = "conversation" | "roleplay" | "game" | "visual_novel";

export interface MusicDjIntent {
  provider: MusicDjProvider;
  mode: MusicDjMode;
  sceneText: string;
  activeCharacterIds?: string[];
  characters?: Array<{ id: string; name: string; description?: string | null; personality?: string | null }>;
  persona?: { id?: string | null; name: string; description?: string | null; personality?: string | null } | null;
  hints?: {
    mood?: string | null;
    energy?: "low" | "medium" | "high" | null;
    vocals?: "instrumental" | "vocals" | "either" | null;
    duration?: "song" | "ambience" | "long_mix" | null;
    genre?: string | null;
    sceneType?: string | null;
  };
  sourceConstraints?: Record<string, unknown> | null;
  avoidVideoIds?: string[];
}

export interface YouTubeSearchItem {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnailUrl: string;
  embeddable: boolean;
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

export interface YouTubeSearcher {
  search(query: string, intent: MusicDjIntent): Promise<YouTubeSearchItem[]>;
}

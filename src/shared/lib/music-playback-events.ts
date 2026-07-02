import type { MusicCandidate } from "../api/music-api";
import type { MusicDjIntent } from "./music-dj-intent";

export const MUSIC_PLAYBACK_EVENT = "de-koi:music-playback";

export type MusicPlaybackEventDetail =
  | {
      type: "cue";
      query?: string | null;
      track?: MusicCandidate | null;
      volume?: number | null;
      intent?: MusicDjIntent | null;
      fresh?: boolean | null;
    }
  | { type: "volume"; volume: number; intent?: MusicDjIntent | null }
  | { type: "stop" }
  | { type: "pause" };

export function dispatchMusicPlaybackEvent(detail: MusicPlaybackEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MusicPlaybackEventDetail>(MUSIC_PLAYBACK_EVENT, { detail }));
}
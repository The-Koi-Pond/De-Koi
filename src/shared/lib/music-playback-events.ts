import type { MusicCandidate } from "../api/music-api";

export const MUSIC_PLAYBACK_EVENT = "de-koi:music-playback";

export type MusicPlaybackEventDetail =
  | { type: "cue"; query?: string | null; track?: MusicCandidate | null; volume?: number | null }
  | { type: "volume"; volume: number }
  | { type: "stop" }
  | { type: "pause" };

export function dispatchMusicPlaybackEvent(detail: MusicPlaybackEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MusicPlaybackEventDetail>(MUSIC_PLAYBACK_EVENT, { detail }));
}

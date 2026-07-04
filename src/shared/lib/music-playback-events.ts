import type { MusicCandidate } from "../api/music-api";
import type { MusicDjIntent } from "./music-dj-intent";

export const MUSIC_PLAYBACK_EVENT = "de-koi:music-playback";

export type MusicPlaybackContextEventDetail = {
  type: "context";
  query?: string | null;
  intent?: MusicDjIntent | null;
};

export type MusicPlaybackEventDetail =
  | {
      type: "cue";
      query?: string | null;
      track?: MusicCandidate | null;
      volume?: number | null;
      intent?: MusicDjIntent | null;
      fresh?: boolean | null;
    }
  | MusicPlaybackContextEventDetail
  | { type: "volume"; volume: number; intent?: MusicDjIntent | null }
  | { type: "stop" }
  | { type: "pause" };

let lastMusicPlaybackContext: MusicPlaybackContextEventDetail | null = null;
let pendingMusicPlaybackCue: Extract<MusicPlaybackEventDetail, { type: "cue" }> | null = null;

export function getLastMusicPlaybackContext(): MusicPlaybackContextEventDetail | null {
  return lastMusicPlaybackContext;
}

export function consumePendingMusicPlaybackCue(): Extract<MusicPlaybackEventDetail, { type: "cue" }> | null {
  const cue = pendingMusicPlaybackCue;
  pendingMusicPlaybackCue = null;
  return cue;
}

export function dispatchMusicPlaybackEvent(detail: MusicPlaybackEventDetail): void {
  if (detail.type === "context") {
    lastMusicPlaybackContext = detail.query?.trim() ? detail : null;
  }
  if (detail.type === "cue" && (detail.query?.trim() || detail.track)) {
    pendingMusicPlaybackCue = detail;
  } else if (detail.type === "stop" || detail.type === "pause") {
    pendingMusicPlaybackCue = null;
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MusicPlaybackEventDetail>(MUSIC_PLAYBACK_EVENT, { detail }));
}

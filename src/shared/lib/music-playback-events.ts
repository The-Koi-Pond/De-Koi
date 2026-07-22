import type { MusicCandidate } from "../api/music-api";
import type { MusicDjIntent } from "./music-dj-intent";

export const MUSIC_PLAYBACK_EVENT = "de-koi:music-playback";
export const MUSIC_AI_PICK_REQUEST_EVENT = "de-koi:music-ai-pick-request";
export const MUSIC_AI_PICK_CHOOSING_MESSAGE = "Music Player is choosing from this scene...";
export const MUSIC_AI_PICK_NO_TRACK_MESSAGE = "Music Player finished without choosing a track.";
export const MUSIC_AI_PICK_FAILED_MESSAGE = "Music Player couldn't choose from this scene.";
const MUSIC_AI_PICK_BUSY_MESSAGE = "Music Player can't start while another response or agent is still running.";

type MusicAiPickCompletion = {
  status: "completed" | "failed";
  message?: string;
};

export type MusicAiPickRequestDetail = {
  fresh?: boolean | null;
  volume: number;
  complete?: (result: MusicAiPickCompletion) => void;
};

function normalizeMusicVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 55;
}

export function handleMusicAiPickRequest(
  event: Event,
  options: { blocked: boolean; run: (detail: MusicAiPickRequestDetail) => Promise<unknown> },
): void {
  event.preventDefault();
  const rawDetail = (event as CustomEvent<Partial<MusicAiPickRequestDetail>>).detail ?? {};
  const detail: MusicAiPickRequestDetail = {
    ...rawDetail,
    volume: normalizeMusicVolume(rawDetail.volume),
  };
  const complete = detail.complete;
  if (options.blocked) {
    complete?.({
      status: "failed",
      message: MUSIC_AI_PICK_BUSY_MESSAGE,
    });
    return;
  }
  void options.run(detail).then(
    () => complete?.({ status: "completed" }),
    () => complete?.({ status: "failed", message: MUSIC_AI_PICK_FAILED_MESSAGE }),
  );
}

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

export function requestMusicAiPick(detail: MusicAiPickRequestDetail): boolean {
  if (typeof window === "undefined") return false;
  const normalizedDetail = { ...detail, volume: normalizeMusicVolume(detail.volume) };
  const event = new CustomEvent<MusicAiPickRequestDetail>(MUSIC_AI_PICK_REQUEST_EVENT, {
    cancelable: true,
    detail: normalizedDetail,
  });
  return window.dispatchEvent(event) === false;
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

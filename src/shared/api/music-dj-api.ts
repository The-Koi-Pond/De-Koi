import type { MusicDjFeedbackInput, MusicDjIntent, MusicDjResolveResponse, MusicDjTrack } from "../../engine/contracts/types/music-dj";
import { invokeTauri } from "./tauri-client";

export interface MusicDjStatusResponse {
  ok?: boolean;
  available?: boolean;
  provider?: "youtube" | "spotify-legacy";
  configured?: boolean;
  error?: string | null;
}

export const musicDjApi = {
  status: () => invokeTauri<MusicDjStatusResponse>("music_dj_status"),
  resolve: (input: MusicDjIntent) => invokeTauri<MusicDjResolveResponse>("music_dj_resolve", { input }),
  feedback: (input: MusicDjFeedbackInput) => invokeTauri<{ success?: boolean }>("music_dj_feedback", { input }),
  playLocal: (track: MusicDjTrack) => Promise.resolve({ success: true, track }),
};

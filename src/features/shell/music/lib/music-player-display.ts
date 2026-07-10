import type { MusicCandidate } from "../../../../shared/api/music-api";

export interface MusicPlayerDisplay {
  title: string;
  subtitle: string;
}

export function getMusicPlayerDisplay(track: MusicCandidate | null): MusicPlayerDisplay {
  const title = track?.title?.trim() || "Music Player";
  const subtitle = track?.channelOrArtist?.trim() || "Generate a fresh pick or activate the Music Player agent";
  return { title, subtitle };
}

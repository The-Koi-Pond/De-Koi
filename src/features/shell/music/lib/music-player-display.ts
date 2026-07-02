import type { MusicCandidate } from "../../../../shared/api/music-api";

export interface MusicPlayerDisplay {
  title: string;
  subtitle: string;
}

export function getMusicPlayerDisplay(track: MusicCandidate | null): MusicPlayerDisplay {
  const title = track?.title?.trim() || "Music DJ";
  const subtitle = track?.channelOrArtist?.trim() || "YouTube first";
  return { title, subtitle };
}

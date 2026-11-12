import { useQuery } from "@tanstack/react-query";
import { Music2 } from "lucide-react";
import { useState } from "react";

import {
  MUSIC_SPOTIFY_SOURCE_KEY,
  readChatSpotifySource,
  type ChatSpotifySource,
} from "../../../../../../engine/shared/music/chat-music";
import { spotifyMusicApi } from "../../../../../../shared/api/music-api";
import { useMusicPlayerSettings } from "../../../../../../shared/hooks/use-music-player-settings";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { ChatSettingsSection as Section } from "./ChatSettingsSections";

type SourceType = ChatSpotifySource["type"];

const SOURCE_CHOICES: ReadonlyArray<readonly [SourceType, string]> = [
  ["liked", "Liked Songs"],
  ["playlist", "A playlist"],
  ["artist", "An artist"],
  ["anything", "Anything"],
];
const UNREADABLE_PLAYLIST_MESSAGE = "Spotify won't let De-Koi read this playlist. Pick a playlist this account owns.";
const FIELD =
  "w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] text-[var(--foreground)] ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)]/50 focus:outline-none focus:ring-[var(--primary)]/40";

/** "Spotify music from": where this chat's Spotify picks come from. Shown only while Spotify is the Music Player source. */
export function ChatSpotifySourceSection({
  metadata,
  onMetadataPatch,
}: {
  metadata: Record<string, unknown>;
  onMetadataPatch: (patch: Record<string, unknown>) => void;
}) {
  const settingsQuery = useMusicPlayerSettings();
  const source = readChatSpotifySource(metadata);
  // Playlist and artist need a value before they mean anything; until then the choice is only on screen.
  const [draftType, setDraftType] = useState<SourceType | null>(null);
  const [artistDraft, setArtistDraft] = useState<string | null>(null);
  const shownType = draftType ?? source.type;
  const spotifySelected = settingsQuery.data?.source === "spotify";
  const playlistsQuery = useQuery({
    queryKey: ["music", "spotify", "playlists"],
    queryFn: () => spotifyMusicApi.playlists(),
    enabled: spotifySelected && shownType === "playlist",
    staleTime: 5 * 60_000,
  });

  if (!spotifySelected) return null;

  const save = (next: ChatSpotifySource) => {
    setDraftType(null);
    setArtistDraft(null);
    onMetadataPatch({ [MUSIC_SPOTIFY_SOURCE_KEY]: next });
  };
  const chooseType = (type: SourceType) => {
    if (type === "liked" || type === "anything") save({ type });
    else setDraftType(type === source.type ? null : type);
  };
  const playlists = playlistsQuery.data?.playlists ?? [];
  const chosenPlaylistId = source.type === "playlist" ? source.playlistId : "";
  const chosenPlaylist = playlists.find((playlist) => playlist.id === chosenPlaylistId);
  const savedArtist = source.type === "artist" ? source.artist : "";
  const commitArtist = () => {
    const artist = (artistDraft ?? savedArtist).trim();
    if (artist && artist !== savedArtist) save({ type: "artist", artist });
  };

  return (
    <Section
      label="Spotify music from"
      icon={<Music2 size="0.875rem" />}
      help="Where the Music Player looks for this chat's Spotify tracks. Liked Songs unless you pick something else."
    >
      <div className="space-y-2">
        <div role="radiogroup" aria-label="Spotify music from" className="grid grid-cols-2 gap-1.5">
          {SOURCE_CHOICES.map(([type, label]) => (
            <label key={type} className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem]">
              <input
                type="radio"
                name="chat-spotify-source"
                checked={shownType === type}
                onChange={() => chooseType(type)}
              />
              {label}
            </label>
          ))}
        </div>

        {shownType === "playlist" && (
          <div className="space-y-1">
            <select
              value={chosenPlaylistId}
              onChange={(event) => {
                const playlist = playlists.find((entry) => entry.id === event.target.value);
                if (playlist?.readable)
                  save({ type: "playlist", playlistId: playlist.id, playlistName: playlist.name });
              }}
              aria-label="Spotify playlist"
              disabled={playlistsQuery.isLoading}
              className={FIELD}
            >
              <option value="" disabled>
                {playlistsQuery.isLoading ? "Loading playlists..." : "Pick a playlist"}
              </option>
              {chosenPlaylistId && !chosenPlaylist && (
                <option value={chosenPlaylistId}>
                  {source.type === "playlist" && source.playlistName ? source.playlistName : "Saved playlist"}
                </option>
              )}
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id} disabled={!playlist.readable}>
                  {playlist.readable ? playlist.name : `${playlist.name} (can't be read)`}
                </option>
              ))}
            </select>
            {playlistsQuery.isError && (
              <p className="text-[0.625rem] text-red-400">
                {toUserMessage(playlistsQuery.error, { fallback: "Couldn't load your Spotify playlists. Try again." })}
              </p>
            )}
            {chosenPlaylist && !chosenPlaylist.readable && (
              <p className="text-[0.625rem] text-red-400">{UNREADABLE_PLAYLIST_MESSAGE}</p>
            )}
          </div>
        )}

        {shownType === "artist" && (
          <input
            value={artistDraft ?? savedArtist}
            onChange={(event) => setArtistDraft(event.target.value)}
            onBlur={commitArtist}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitArtist();
            }}
            placeholder="Artist name"
            aria-label="Spotify artist"
            className={FIELD}
          />
        )}

        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          {shownType === "anything"
            ? "Searches all of Spotify for music that fits the scene."
            : shownType === "artist"
              ? "Searches Spotify for this artist's music that fits the scene."
              : shownType === "playlist"
                ? "Picks from this playlist. Playlists you follow but don't own often can't be read."
                : "Picks from your Liked Songs."}
        </p>
      </div>
    </Section>
  );
}

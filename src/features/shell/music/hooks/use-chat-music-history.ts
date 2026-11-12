import {
  MUSIC_RECENT_TRACKS_KEY,
  readChatMusicRecentTracks,
  readChatSpotifySource,
  withMusicRecentTrack,
  type ChatSpotifySource,
  type MusicRecentTrackEntry,
} from "../../../../engine/shared/music/chat-music";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUpdateChatMetadata } from "../../../catalog/chats/index";

/**
 * The open chat's music data: its Spotify source and recently played tracks.
 * Reads the chat at call time, so a pick always uses the newest history.
 */
export function useChatMusicHistory() {
  const updateMetadata = useUpdateChatMetadata();

  return {
    recentTracks(): MusicRecentTrackEntry[] {
      return readChatMusicRecentTracks(useChatStore.getState().activeChat?.metadata);
    },
    spotifySource(): ChatSpotifySource {
      return readChatSpotifySource(useChatStore.getState().activeChat?.metadata);
    },
    /** Adds a track whose playback was confirmed or accepted. Does nothing without an open chat. */
    record(track: MusicRecentTrackEntry): void {
      const chat = useChatStore.getState().activeChat;
      if (!chat?.id) return;
      const history = readChatMusicRecentTracks(chat.metadata);
      const newest = history[0];
      if (newest?.provider === track.provider && newest.id === track.id) return;
      updateMetadata.mutate({ id: chat.id, [MUSIC_RECENT_TRACKS_KEY]: withMusicRecentTrack(history, track) });
    },
  };
}

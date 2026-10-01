const SPOTIFY_SCENE_TRACK_CHANGE_EVENT = "marinara:spotify-scene-track-change";

export type SpotifySceneTrackChangeDetail = {
  uri: string;
};

export function dispatchSpotifySceneTrackChange(uri: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SpotifySceneTrackChangeDetail>(SPOTIFY_SCENE_TRACK_CHANGE_EVENT, {
      detail: { uri },
    }),
  );
}

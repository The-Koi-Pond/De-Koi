import { queryOptions, useQuery } from "@tanstack/react-query";

import { musicApi } from "../api/music-api";

export const musicPlayerSettingsQueryKey = ["music", "settings"] as const;

/** The Music Player's source and Spotify settings, shared by its settings, the widget and chat settings. */
export const musicPlayerSettingsQuery = queryOptions({
  queryKey: musicPlayerSettingsQueryKey,
  queryFn: () => musicApi.settings(),
  staleTime: 60_000,
});

export function useMusicPlayerSettings() {
  return useQuery(musicPlayerSettingsQuery);
}

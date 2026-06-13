import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gameApi } from "../api/game-api";
import { spotifyApi } from "../../../../shared/api/integration-utility-api";
import { dispatchSpotifySceneTrackChange } from "../../../../shared/lib/spotify-playback-events";
import type {
  SceneAnalysis,
  SceneSpotifyTrackCandidate,
  SceneSpotifyTrackSelection,
} from "../../../../engine/contracts/types/scene";

type GameSpotifyCandidatesResponse = {
  enabled: boolean;
  tracks: SceneSpotifyTrackCandidate[];
  reason?: string;
};

type SpotifyPlayerSnapshot = {
  device?: {
    id: string | null;
    name?: string | null;
    type?: string | null;
    isActive?: boolean;
  } | null;
};

type SpotifyDevicesSnapshot = {
  devices?: Array<{
    id: string | null;
    name?: string | null;
    type?: string | null;
    isActive?: boolean;
  }>;
};

type SpotifySceneRetryRequest = {
  narration: string;
  playerAction?: string | null;
  context: Record<string, unknown>;
  sceneConnectionId?: string | null;
};

type UseGameSpotifySceneMusicParams = {
  activeChatId: string;
  buildRetryRequest: () => SpotifySceneRetryRequest | null;
  enabled: boolean;
  isStreaming: boolean;
  persistMetadata: (chatId: string, patch: Record<string, unknown>) => Promise<unknown>;
  queryClient: QueryClient;
  recentSpotifyTracks: unknown;
  sceneAnalysisMutateAsync: (request: {
    chatId?: string;
    connectionId?: string;
    narration: string;
    playerAction?: string | null;
    context: Record<string, unknown>;
  }) => Promise<SceneAnalysis>;
  sceneAnalysisPending: boolean;
  setRetryMenuOpen: (open: boolean) => void;
};

const RECENT_SPOTIFY_TRACK_HISTORY_LIMIT = 12;

function isMobileGameViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function isBrowserSpotifyDeviceName(name: string | null | undefined): boolean {
  return name === "De-Koi" || name === "Marinara Engine";
}

function isPersonalMobileSpotifyDeviceType(type: string | null | undefined): boolean {
  const normalized = type?.trim().toLowerCase();
  return normalized === "smartphone" || normalized === "tablet";
}

function normalizeRecentSpotifyTrackHistory(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((uri): uri is string => typeof uri === "string" && uri.startsWith("spotify:track:"))
        .slice(0, RECENT_SPOTIFY_TRACK_HISTORY_LIMIT)
    : [];
}

function appendRecentSpotifyTrack(history: string[], uri: string | null | undefined): string[] {
  if (!uri?.startsWith("spotify:track:")) return history.slice(0, RECENT_SPOTIFY_TRACK_HISTORY_LIMIT);
  return [uri, ...history.filter((item) => item !== uri)].slice(0, RECENT_SPOTIFY_TRACK_HISTORY_LIMIT);
}

export function useGameSpotifySceneMusic({
  activeChatId,
  buildRetryRequest,
  enabled,
  isStreaming,
  persistMetadata,
  queryClient,
  recentSpotifyTracks,
  sceneAnalysisMutateAsync,
  sceneAnalysisPending,
  setRetryMenuOpen,
}: UseGameSpotifySceneMusicParams) {
  const [spotifyRetryPending, setSpotifyRetryPending] = useState(false);
  const recentSpotifyTrackHistoryRef = useRef<string[]>(normalizeRecentSpotifyTrackHistory(recentSpotifyTracks));

  const resetRecentSpotifyTrackHistory = useCallback((value: unknown) => {
    recentSpotifyTrackHistoryRef.current = normalizeRecentSpotifyTrackHistory(value);
  }, []);

  useEffect(() => {
    resetRecentSpotifyTrackHistory(recentSpotifyTracks);
  }, [activeChatId, recentSpotifyTracks, resetRecentSpotifyTrackHistory]);

  const canRetrySpotifyMusic =
    enabled && !!activeChatId && !isStreaming && !sceneAnalysisPending && !spotifyRetryPending;

  const fetchSpotifySceneCandidates = useCallback(
    async (
      narration: string,
      context: Record<string, unknown>,
      playerAction?: string | null,
    ): Promise<SceneSpotifyTrackCandidate[]> => {
      if (!enabled || !activeChatId) return [];
      setSpotifyRetryPending(true);
      try {
        const result = (await gameApi.spotifyCandidates({
          chatId: activeChatId,
          narration,
          playerAction: playerAction ?? undefined,
          context,
          limit: 50,
        })) as GameSpotifyCandidatesResponse;
        return result.enabled ? (result.tracks ?? []) : [];
      } catch (error) {
        console.warn("[spotify/game] Failed to prepare scene music candidates:", error);
        return [];
      } finally {
        setSpotifyRetryPending(false);
      }
    },
    [activeChatId, enabled],
  );

  const playSpotifySceneTrack = useCallback(
    async (track?: SceneSpotifyTrackSelection | null) => {
      if (!activeChatId || !enabled || !track?.uri) return;
      setSpotifyRetryPending(true);
      try {
        const cachedPlayer = queryClient.getQueryData<SpotifyPlayerSnapshot>(["spotify", "player"]) ?? null;
        let spotifyPlayer = cachedPlayer;
        if (!spotifyPlayer?.device?.id) {
          spotifyPlayer = await spotifyApi.player<SpotifyPlayerSnapshot>().catch(() => cachedPlayer);
        }

        const mobileViewport = isMobileGameViewport();
        const currentDevice = spotifyPlayer?.device ?? null;
        let spotifyDeviceId = currentDevice?.id ?? null;
        const currentDeviceIsMobile = isPersonalMobileSpotifyDeviceType(currentDevice?.type);
        const shouldPreferMobileDevice =
          mobileViewport &&
          (!spotifyDeviceId || !currentDeviceIsMobile || isBrowserSpotifyDeviceName(currentDevice?.name));

        if (shouldPreferMobileDevice) {
          const devices = await spotifyApi.devices<SpotifyDevicesSnapshot>().catch(() => null);
          const mobileDevices = (devices?.devices ?? []).filter(
            (device) =>
              !!device.id && !isBrowserSpotifyDeviceName(device.name) && isPersonalMobileSpotifyDeviceType(device.type),
          );
          const preferredDevice = mobileDevices.find((device) => device.isActive) ?? mobileDevices[0] ?? null;
          if (preferredDevice?.id) {
            spotifyDeviceId = preferredDevice.id;
          } else if (!currentDeviceIsMobile) {
            spotifyDeviceId = null;
          }
        }

        await gameApi.spotifyPlay({
          chatId: activeChatId,
          track,
          deviceId: spotifyDeviceId ?? undefined,
          mobileDeviceOnly: mobileViewport,
        } as { track: SceneSpotifyTrackSelection; deviceId?: string | null });
        dispatchSpotifySceneTrackChange(track.uri);
        recentSpotifyTrackHistoryRef.current = appendRecentSpotifyTrack(
          recentSpotifyTrackHistoryRef.current,
          track.uri,
        );
        persistMetadata(activeChatId, { gameRecentSpotifyTracks: recentSpotifyTrackHistoryRef.current }).catch(
          () => {},
        );
        await queryClient.invalidateQueries({ queryKey: ["spotify", "player"] });
      } catch (error) {
        console.warn("[spotify/game] Failed to play scene track:", error);
        toast.error(error instanceof Error ? error.message : "Spotify scene music failed.");
      } finally {
        setSpotifyRetryPending(false);
      }
    },
    [activeChatId, enabled, persistMetadata, queryClient],
  );

  const handleRetrySpotifyMusic = useCallback(async () => {
    if (!activeChatId || !enabled || isStreaming || sceneAnalysisPending) return;
    const retryRequest = buildRetryRequest();
    if (!retryRequest) return;
    setRetryMenuOpen(false);

    try {
      const availableSpotifyTracks = await fetchSpotifySceneCandidates(
        retryRequest.narration,
        retryRequest.context,
        retryRequest.playerAction,
      );
      if (availableSpotifyTracks.length === 0) {
        toast.error("No Spotify tracks were available for this scene.");
        return;
      }

      let selectedTrack: SceneSpotifyTrackSelection | null = null;
      if (retryRequest.sceneConnectionId) {
        const result = await sceneAnalysisMutateAsync({
          chatId: activeChatId,
          connectionId: retryRequest.sceneConnectionId || undefined,
          narration: retryRequest.narration,
          playerAction: retryRequest.playerAction ?? undefined,
          context: { ...retryRequest.context, availableSpotifyTracks },
        });
        selectedTrack = result.spotifyTrack ?? null;
      }

      if (!selectedTrack) {
        const fallback = availableSpotifyTracks[0]!;
        selectedTrack = {
          uri: fallback.uri,
          name: fallback.name,
          artist: fallback.artist,
          album: fallback.album ?? null,
        };
      }

      await playSpotifySceneTrack(selectedTrack);
      toast.success("Spotify scene music refreshed.", { duration: 1800 });
    } catch (error) {
      console.warn("[spotify/game] Retry failed:", error);
      toast.error("Spotify scene music retry failed.");
    } finally {
      setSpotifyRetryPending(false);
    }
  }, [
    activeChatId,
    buildRetryRequest,
    enabled,
    fetchSpotifySceneCandidates,
    isStreaming,
    playSpotifySceneTrack,
    sceneAnalysisMutateAsync,
    sceneAnalysisPending,
    setRetryMenuOpen,
  ]);

  return {
    canRetrySpotifyMusic,
    fetchSpotifySceneCandidates,
    handleRetrySpotifyMusic,
    playSpotifySceneTrack,
    recentSpotifyTrackHistoryRef,
    resetRecentSpotifyTrackHistory,
    spotifyRetryPending,
  };
}

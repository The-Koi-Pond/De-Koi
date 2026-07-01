import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  SceneAnalysis,
  SceneMusicTrackCandidate,
  SceneMusicTrackSelection,
} from "../../../../engine/contracts/types/scene";
import { musicApi, type MusicCandidate } from "../../../../shared/api/music-api";
import { dispatchMusicPlaybackEvent } from "../../../../shared/lib/music-playback-events";

type MusicSceneRetryRequest = {
  narration: string;
  playerAction?: string | null;
  context: Record<string, unknown>;
  sceneConnectionId?: string | null;
};

type UseGameMusicSceneMusicParams = {
  activeChatId: string;
  buildRetryRequest: (recentMusicTracks: string[]) => MusicSceneRetryRequest | null;
  enabled: boolean;
  isStreaming: boolean;
  persistMetadata: (chatId: string, patch: Record<string, unknown>) => Promise<unknown>;
  recentMusicTracks: unknown;
  sceneAnalysisMutateAsync: (request: {
    chatId?: string;
    connectionId?: string | null;
    narration: string;
    playerAction?: string | null;
    context: Record<string, unknown>;
  }) => Promise<SceneAnalysis>;
  sceneAnalysisPending: boolean;
  setRetryMenuOpen: (open: boolean) => void;
};

const RECENT_MUSIC_TRACK_HISTORY_LIMIT = 12;

function normalizeRecentMusicTrackHistory(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
        .slice(0, RECENT_MUSIC_TRACK_HISTORY_LIMIT)
    : [];
}

function appendRecentMusicTrack(history: string[], id: string | null | undefined): string[] {
  if (!id?.trim()) return history.slice(0, RECENT_MUSIC_TRACK_HISTORY_LIMIT);
  return [id, ...history.filter((item) => item !== id)].slice(0, RECENT_MUSIC_TRACK_HISTORY_LIMIT);
}

function toSceneCandidate(candidate: MusicCandidate): SceneMusicTrackCandidate {
  return {
    provider: candidate.provider,
    id: candidate.id,
    title: candidate.title,
    channelOrArtist: candidate.channelOrArtist ?? null,
    url: candidate.url ?? null,
    thumbnail: candidate.thumbnail ?? null,
    durationSeconds: candidate.durationSeconds ?? null,
    confidence: candidate.confidence ?? null,
    reasonTags: candidate.reasonTags ?? [],
  };
}

function toPlaybackCandidate(track: SceneMusicTrackSelection): MusicCandidate {
  return {
    provider: track.provider,
    id: track.id,
    title: track.title ?? track.id,
    channelOrArtist: track.channelOrArtist ?? null,
    url: track.url ?? null,
    thumbnail: track.thumbnail ?? null,
    durationSeconds: track.durationSeconds ?? null,
  };
}

function sceneMusicQuery(narration: string, context: Record<string, unknown>, playerAction?: string | null): string {
  const genre = typeof context.genre === "string" ? context.genre : "";
  const setting = typeof context.setting === "string" ? context.setting : "";
  const state = typeof context.currentState === "string" ? context.currentState : "scene";
  const player = playerAction ? ` ${playerAction}` : "";
  const source = `${state} ${genre} ${setting} ${narration}${player}`.replace(/\s+/g, " ").trim();
  return `${source.slice(0, 180)} instrumental ambient`;
}

export function useGameMusicSceneMusic({
  activeChatId,
  buildRetryRequest,
  enabled,
  isStreaming,
  persistMetadata,
  recentMusicTracks,
  sceneAnalysisMutateAsync,
  sceneAnalysisPending,
  setRetryMenuOpen,
}: UseGameMusicSceneMusicParams) {
  const [musicRetryPending, setMusicRetryPending] = useState(false);
  const recentMusicTrackHistoryRef = useRef<string[]>(normalizeRecentMusicTrackHistory(recentMusicTracks));

  const resetRecentMusicTrackHistory = useCallback((value: unknown) => {
    recentMusicTrackHistoryRef.current = normalizeRecentMusicTrackHistory(value);
  }, []);

  useEffect(() => {
    resetRecentMusicTrackHistory(recentMusicTracks);
  }, [activeChatId, recentMusicTracks, resetRecentMusicTrackHistory]);

  const canRetryMusic = enabled && !!activeChatId && !isStreaming && !sceneAnalysisPending && !musicRetryPending;

  const fetchMusicSceneCandidates = useCallback(
    async (
      narration: string,
      context: Record<string, unknown>,
      playerAction?: string | null,
    ): Promise<SceneMusicTrackCandidate[]> => {
      if (!enabled || !activeChatId) return [];
      setMusicRetryPending(true);
      try {
        const query = sceneMusicQuery(narration, context, playerAction);
        const result = await musicApi.searchCandidates({
          provider: "youtube",
          query,
          limit: 8,
          recentMusicTracks: recentMusicTrackHistoryRef.current,
        });
        return (result.candidates ?? []).map(toSceneCandidate);
      } catch (error) {
        console.warn("[music/game] Failed to prepare scene music candidates:", error);
        return [];
      } finally {
        setMusicRetryPending(false);
      }
    },
    [activeChatId, enabled],
  );

  const playMusicSceneTrack = useCallback(
    async (track?: SceneMusicTrackSelection | null) => {
      if (!activeChatId || !enabled || !track?.id) return;
      try {
        const playbackTrack = toPlaybackCandidate(track);
        dispatchMusicPlaybackEvent({ type: "cue", track: playbackTrack });
        recentMusicTrackHistoryRef.current = appendRecentMusicTrack(recentMusicTrackHistoryRef.current, track.id);
        await persistMetadata(activeChatId, { gameRecentMusicTracks: recentMusicTrackHistoryRef.current });
      } catch (error) {
        console.warn("[music/game] Failed to play scene track:", error);
        toast.error(error instanceof Error ? error.message : "Music DJ scene music failed.");
      }
    },
    [activeChatId, enabled, persistMetadata],
  );

  const handleRetryMusic = useCallback(async () => {
    if (!activeChatId || !enabled || isStreaming || sceneAnalysisPending) return;
    const retryRequest = buildRetryRequest(recentMusicTrackHistoryRef.current);
    if (!retryRequest) return;
    setRetryMenuOpen(false);

    try {
      const availableMusicTracks = await fetchMusicSceneCandidates(
        retryRequest.narration,
        retryRequest.context,
        retryRequest.playerAction,
      );
      if (availableMusicTracks.length === 0) {
        toast.error("No Music DJ tracks were available for this scene.");
        return;
      }

      let selectedTrack: SceneMusicTrackSelection | null = null;
      if (retryRequest.sceneConnectionId) {
        const result = await sceneAnalysisMutateAsync({
          chatId: activeChatId,
          connectionId: retryRequest.sceneConnectionId || undefined,
          narration: retryRequest.narration,
          playerAction: retryRequest.playerAction ?? undefined,
          context: { ...retryRequest.context, useMusicDj: true, availableMusicTracks },
        });
        selectedTrack = result.musicTrack ?? null;
      }

      if (!selectedTrack) {
        const fallback = availableMusicTracks[0]!;
        selectedTrack = {
          provider: fallback.provider,
          id: fallback.id,
          title: fallback.title,
          channelOrArtist: fallback.channelOrArtist ?? null,
          url: fallback.url ?? null,
          thumbnail: fallback.thumbnail ?? null,
          durationSeconds: fallback.durationSeconds ?? null,
        };
      }

      await playMusicSceneTrack(selectedTrack);
      toast.success("Music DJ scene music refreshed.", { duration: 1800 });
    } catch (error) {
      console.warn("[music/game] Retry failed:", error);
      toast.error("Music DJ scene music retry failed.");
    } finally {
      setMusicRetryPending(false);
    }
  }, [
    activeChatId,
    buildRetryRequest,
    enabled,
    fetchMusicSceneCandidates,
    isStreaming,
    playMusicSceneTrack,
    sceneAnalysisMutateAsync,
    sceneAnalysisPending,
    setRetryMenuOpen,
  ]);

  return {
    canRetryMusic,
    fetchMusicSceneCandidates,
    handleRetryMusic,
    musicRetryPending,
    playMusicSceneTrack,
    recentMusicTrackHistoryRef,
    resetRecentMusicTrackHistory,
  };
}

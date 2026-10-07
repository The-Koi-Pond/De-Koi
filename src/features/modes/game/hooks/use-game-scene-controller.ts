import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { audioManager } from "../lib/game-audio";
import { resolveAssetTag } from "../lib/asset-fuzzy-match";
import { useGameAssetStore } from "../stores/game-asset.store";
import { useGameModeStore } from "../stores/game-mode.store";
import type { Message } from "../../../../engine/contracts/types/chat";
import type { DirectionCommand } from "../../../../engine/contracts/types/game";
import type { SceneAnalysis, SceneSegmentEffect } from "../../../../engine/contracts/types/scene";
import type { InventoryTag } from "../lib/game-tag-parser";

type GameAssetManifestMap = Record<string, { path: string; absolutePath?: string }> | null;

type UseGameSceneControllerParams = {
  sceneRuntimeScopeKey: string;
  isMessagesLoading: boolean;
  isStreaming: boolean;
  latestAssistantMsg: Message | null;
  latestAssistantDirectAddressMode: unknown;
  hasAsyncScenePrep: boolean;
  pendingInventorySegmentUpdates: Array<{ segment: number; update: InventoryTag }>;
  appliedInventorySegmentsRef: MutableRefObject<Set<number>>;
  scopedAssetMap: GameAssetManifestMap;
  useSpotifyGameMusic: boolean;
  applyInventoryUpdates: (updates: InventoryTag[]) => Promise<boolean>;
  /** Called after a reply's segment inventory lands, with every segment of that reply applied so far. */
  onInventorySegmentsApplied?: (messageId: string, appliedSegments: number[]) => void;
  playDirections: (directions: DirectionCommand[]) => void;
};

// The segment the narration resumed at after a reload, per applied-segment set. Every new reply
// gets a fresh set, so keying on it drops the resume point together with the applied claims.
const resumedInventorySegment = new WeakMap<Set<number>, number>();
// Claimed segments whose inventory apply hasn't settled yet. Progress reports only segments that
// actually landed, so a reload never skips one whose apply then failed.
const inFlightInventorySegments = new WeakMap<Set<number>, Set<number>>();

export function useGameSceneController({
  sceneRuntimeScopeKey,
  isMessagesLoading,
  isStreaming,
  latestAssistantMsg,
  latestAssistantDirectAddressMode,
  hasAsyncScenePrep,
  pendingInventorySegmentUpdates,
  appliedInventorySegmentsRef,
  scopedAssetMap,
  useSpotifyGameMusic,
  applyInventoryUpdates,
  onInventorySegmentsApplied,
  playDirections,
}: UseGameSceneControllerParams) {
  const [narrationDoneMsgId, setNarrationDoneMsgId] = useState<string | null>(null);
  const [pendingSegmentEffects, setPendingSegmentEffects] = useState<SceneSegmentEffect[]>([]);
  const [sceneAnalysisFailed, setSceneAnalysisFailed] = useState(false);
  const [sceneStuckVisible, setSceneStuckVisible] = useState(false);
  const sceneReadyMsgIdRef = useRef<string | undefined>(undefined);
  const applySceneResultRef = useRef<((result: SceneAnalysis) => void | Promise<void>) | null>(null);
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  const weatherMsgRef = useRef<string | null>(null);
  const sceneAnalysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSegmentsRef = useRef<Set<number>>(new Set());
  const processSceneRef = useRef<(() => void) | null>(null);
  const isRestoredRef = useRef(false);
  const sceneRestoredRef = useRef(false);
  const previousSceneRuntimeScopeRef = useRef(sceneRuntimeScopeKey);
  void sceneReadyTick;

  const narrationDone =
    typeof narrationDoneMsgId === "string" &&
    typeof latestAssistantMsg?.id === "string" &&
    narrationDoneMsgId === latestAssistantMsg.id;

  const handleNarrationComplete = useCallback((complete: boolean, messageId: string | null) => {
    setNarrationDoneMsgId(complete ? messageId : null);
  }, []);

  const markSceneReady = useCallback((messageId: string) => {
    sceneReadyMsgIdRef.current = messageId;
    setSceneReadyTick((tick) => tick + 1);
  }, []);

  // Segment indexes restart at 0 for every reply, so a new reply must clear both applied
  // sets; a stale inventory claim would otherwise skip the new reply's tag at that index.
  const resetSegmentEffects = useCallback(() => {
    setPendingSegmentEffects([]);
    appliedSegmentsRef.current = new Set();
    appliedInventorySegmentsRef.current = new Set();
  }, [appliedInventorySegmentsRef]);

  if (sceneReadyMsgIdRef.current === undefined && !isMessagesLoading) {
    if (latestAssistantMsg && !isStreaming) {
      isRestoredRef.current = true;
      sceneReadyMsgIdRef.current = latestAssistantMsg.id;
      weatherMsgRef.current = latestAssistantMsg.id;
    } else {
      sceneReadyMsgIdRef.current = "__none__";
      weatherMsgRef.current = null;
    }
  }

  const scenePreparing =
    hasAsyncScenePrep &&
    !isStreaming &&
    latestAssistantMsg != null &&
    !latestAssistantDirectAddressMode &&
    sceneReadyMsgIdRef.current !== latestAssistantMsg.id &&
    !sceneAnalysisFailed;

  const sceneProcessed = latestAssistantMsg == null || sceneReadyMsgIdRef.current === latestAssistantMsg?.id;

  useEffect(() => {
    if (sceneProcessed || isStreaming) {
      setSceneStuckVisible(false);
      return;
    }
    if (!latestAssistantMsg?.content) return;
    const timer = setTimeout(() => setSceneStuckVisible(true), 15_000);
    return () => clearTimeout(timer);
  }, [sceneProcessed, isStreaming, latestAssistantMsg?.content]);

  useEffect(() => {
    if (previousSceneRuntimeScopeRef.current === sceneRuntimeScopeKey) return;
    previousSceneRuntimeScopeRef.current = sceneRuntimeScopeKey;
    sceneReadyMsgIdRef.current = undefined;
    weatherMsgRef.current = null;
    isRestoredRef.current = false;
    sceneRestoredRef.current = false;
    if (sceneAnalysisTimeoutRef.current) {
      clearTimeout(sceneAnalysisTimeoutRef.current);
    }
    sceneAnalysisTimeoutRef.current = null;
    setNarrationDoneMsgId(null);
    setSceneAnalysisFailed(false);
    setSceneStuckVisible(false);
    resetSegmentEffects();
  }, [resetSegmentEffects, sceneRuntimeScopeKey]);

  const latestAssistantMsgId = latestAssistantMsg?.id ?? null;

  // Claim and apply queued inventory updates for the given segments of the current reply.
  const applyInventorySegments = useCallback(
    (isDue: (segment: number) => boolean) => {
      const claimedSegments = appliedInventorySegmentsRef.current;
      const due = pendingInventorySegmentUpdates
        .filter((entry) => isDue(entry.segment) && !claimedSegments.has(entry.segment))
        .sort((a, b) => a.segment - b.segment);
      if (due.length === 0) return;
      const segments = [...new Set(due.map((entry) => entry.segment))];
      const inFlight = inFlightInventorySegments.get(claimedSegments) ?? new Set<number>();
      inFlightInventorySegments.set(claimedSegments, inFlight);
      for (const segment of segments) {
        claimedSegments.add(segment);
        inFlight.add(segment);
      }
      const messageId = latestAssistantMsgId;
      const settle = () => {
        for (const segment of segments) inFlight.delete(segment);
      };
      // Roll back on the set that made the claim; a newer reply may have replaced it by then.
      const rollBack = () => {
        settle();
        for (const segment of segments) claimedSegments.delete(segment);
      };
      void applyInventoryUpdates(due.map((entry) => entry.update))
        .then((applied) => {
          if (!applied) {
            rollBack();
            return;
          }
          settle();
          if (messageId && appliedInventorySegmentsRef.current === claimedSegments) {
            // The metadata writer merges and sends these one at a time per chat, so the latest
            // landed list is the one that persists.
            onInventorySegmentsApplied?.(
              messageId,
              [...claimedSegments].filter((segment) => !inFlight.has(segment)).sort((a, b) => a - b),
            );
          }
        })
        .catch((error) => {
          rollBack();
          console.warn("Failed to apply inventory segment update", error);
        });
    },
    [
      appliedInventorySegmentsRef,
      applyInventoryUpdates,
      latestAssistantMsgId,
      onInventorySegmentsApplied,
      pendingInventorySegmentUpdates,
    ],
  );

  // After a reload the narration resumes mid-reply without "entering" that segment, and the
  // restored queue can arrive before or after it does. Whichever comes second applies every
  // update the reader already reached, so tags at or before the resume point are not lost.
  const applyThroughResumedSegment = useCallback(() => {
    const resumed = resumedInventorySegment.get(appliedInventorySegmentsRef.current);
    if (resumed === undefined) return;
    applyInventorySegments((segment) => segment <= resumed);
  }, [appliedInventorySegmentsRef, applyInventorySegments]);

  useEffect(() => {
    applyThroughResumedSegment();
  }, [applyThroughResumedSegment]);

  /** The narration resumed at this segment after a reload; catches up inventory without replaying scene effects. */
  const handleSegmentResume = useCallback(
    (segmentIndex: number) => {
      resumedInventorySegment.set(appliedInventorySegmentsRef.current, segmentIndex);
      applyThroughResumedSegment();
    },
    [appliedInventorySegmentsRef, applyThroughResumedSegment],
  );

  const handleSegmentEnter = useCallback(
    (segmentIndex: number) => {
      useGameModeStore.getState().setDiceRollResult(null);
      const sceneEffectsApplied = appliedSegmentsRef.current.has(segmentIndex);
      const effects = sceneEffectsApplied ? [] : pendingSegmentEffects.filter((e) => e.segment === segmentIndex);
      applyInventorySegments((segment) => segment === segmentIndex);
      if (effects.length === 0) return;

      const assetMap = scopedAssetMap;
      if (effects.length > 0) {
        appliedSegmentsRef.current.add(segmentIndex);
        for (const fx of effects) {
          if (fx.background) {
            const resolved = resolveAssetTag(fx.background, "backgrounds", assetMap);
            useGameAssetStore.getState().setCurrentBackground(resolved);
          }
          if (fx.music && !useSpotifyGameMusic) {
            const resolved = resolveAssetTag(fx.music, "music", assetMap);
            audioManager.playMusic(resolved, assetMap);
            useGameAssetStore.getState().setCurrentMusic(resolved);
          }
          if (fx.sfx?.length) {
            for (const sfx of fx.sfx) {
              const resolved = resolveAssetTag(sfx, "sfx", assetMap);
              audioManager.playSfx(resolved, assetMap);
            }
          }
          if (fx.ambient) {
            const resolved = resolveAssetTag(fx.ambient, "ambient", assetMap);
            audioManager.playAmbient(resolved, assetMap);
            useGameAssetStore.getState().setCurrentAmbient(resolved);
          }
          if (fx.directions?.length) {
            playDirections(fx.directions);
          }
        }
      }
    },
    [applyInventorySegments, pendingSegmentEffects, playDirections, scopedAssetMap, useSpotifyGameMusic],
  );

  return {
    appliedSegmentsRef,
    applySceneResultRef,
    handleNarrationComplete,
    handleSegmentEnter,
    handleSegmentResume,
    isRestoredRef,
    markSceneReady,
    narrationDone,
    narrationDoneMsgId,
    pendingSegmentEffects,
    processSceneRef,
    resetSegmentEffects,
    sceneAnalysisFailed,
    sceneAnalysisTimeoutRef,
    scenePreparing,
    sceneProcessed,
    sceneReadyMsgIdRef,
    sceneRestoredRef,
    sceneStuckVisible,
    setNarrationDoneMsgId,
    setPendingSegmentEffects,
    setSceneAnalysisFailed,
    setSceneStuckVisible,
    weatherMsgRef,
  };
}

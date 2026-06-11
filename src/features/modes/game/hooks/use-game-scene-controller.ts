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
  playDirections: (directions: DirectionCommand[]) => void;
};

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

  const resetSegmentEffects = useCallback(() => {
    setPendingSegmentEffects([]);
    appliedSegmentsRef.current = new Set();
  }, []);

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

  const handleSegmentEnter = useCallback(
    (segmentIndex: number) => {
      useGameModeStore.getState().setDiceRollResult(null);
      const sceneEffectsApplied = appliedSegmentsRef.current.has(segmentIndex);
      const inventoryApplied = appliedInventorySegmentsRef.current.has(segmentIndex);
      const effects = sceneEffectsApplied ? [] : pendingSegmentEffects.filter((e) => e.segment === segmentIndex);
      const inventoryUpdates = (inventoryApplied ? [] : pendingInventorySegmentUpdates)
        .filter((entry) => entry.segment === segmentIndex)
        .map((entry) => entry.update);
      if (effects.length === 0 && inventoryUpdates.length === 0) return;

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

      if (inventoryUpdates.length > 0) {
        void applyInventoryUpdates(inventoryUpdates)
          .then((applied) => {
            if (applied) {
              appliedInventorySegmentsRef.current.add(segmentIndex);
            }
          })
          .catch((error) => {
            console.warn("Failed to apply inventory segment update", error);
          });
      }
    },
    [
      appliedInventorySegmentsRef,
      applyInventoryUpdates,
      pendingInventorySegmentUpdates,
      pendingSegmentEffects,
      playDirections,
      scopedAssetMap,
      useSpotifyGameMusic,
    ],
  );

  return {
    appliedSegmentsRef,
    applySceneResultRef,
    handleNarrationComplete,
    handleSegmentEnter,
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

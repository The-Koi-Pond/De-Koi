import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ImagePromptReviewModal as GameImagePromptReviewModal,
  type ImagePromptOverride as GameImagePromptOverride,
  type ImagePromptReviewItem as GameImagePromptReviewItem,
} from "../../../../shared/components/ui/ImagePromptReviewModal";
import { galleryKeys } from "../../../catalog/gallery/index";
import type { Chat } from "../../../../engine/contracts/types/chat";
import type { SceneSegmentEffect } from "../../../../engine/contracts/types/scene";
import { gameApi, type GameAssetGenerationPayload, type GameAssetGenerationResult } from "../api/game-api";
import { useGameAssetStore } from "../stores/game-asset.store";
import { useGameModeStore } from "../stores/game-mode.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import type { ImageStyleProfileSettings } from "../../../../engine/generation/image-style-profiles";

export type { GameAssetGenerationPayload, GameAssetGenerationResult } from "../api/game-api";

export type GameAssetGenerationOptions = {
  allowPromptReview?: boolean;
  blocksScene?: boolean;
  showSuccessToast?: boolean;
};

type UseGameAssetGenerationControllerParams = {
  activeChatId: string;
  fetchManifest: () => Promise<unknown> | unknown;
  gameImageGenerationEnabled: boolean;
  normalizeNpcName: (name: string) => string;
  publishSessionChat: (sessionChat: Chat | null | undefined) => void;
  queryClient: QueryClient;
  setPendingSegmentEffects: Dispatch<SetStateAction<SceneSegmentEffect[]>>;
};

const GAME_ASSET_GENERATION_TIMEOUT_MS = 240_000;
const GAME_ASSET_PREVIEW_TIMEOUT_MS = 180_000;
const GAME_ASSET_PROMPT_REVIEW_TIMEOUT_MS = 180_000;
const IMAGE_PROMPT_REVIEW_TIMED_OUT = Symbol("IMAGE_PROMPT_REVIEW_TIMED_OUT");

type TimeoutError = Error & { name: "AbortError"; code?: "ETIMEDOUT" };

function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof Error && error.name === "AbortError";
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  const controller = new AbortController();
  let settled = false;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      controller.abort();
      const err = new Error("Operation timed out") as TimeoutError;
      err.name = "AbortError";
      err.code = "ETIMEDOUT";
      reject(err);
    }, ms);
    run(controller.signal)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getConfiguredGameAssetImageSizes(): NonNullable<GameAssetGenerationPayload["imageSizes"]> {
  const settings = useUIStore.getState();
  return {
    background: { width: settings.imageBackgroundWidth, height: settings.imageBackgroundHeight },
    portrait: { width: settings.imagePortraitWidth, height: settings.imagePortraitHeight },
    selfie: { width: settings.imageSelfieWidth, height: settings.imageSelfieHeight },
  };
}

export function useGameAssetGenerationController({
  activeChatId,
  fetchManifest,
  gameImageGenerationEnabled,
  normalizeNpcName,
  publishSessionChat,
  queryClient,
  setPendingSegmentEffects,
}: UseGameAssetGenerationControllerParams) {
  const [pendingAssetGeneration, setPendingAssetGeneration] = useState<GameAssetGenerationPayload | null>(null);
  const [assetGenerationBlocksScene, setAssetGenerationBlocksScene] = useState(false);
  const [assetGenerationFailed, setAssetGenerationFailed] = useState(false);
  const [failedNpcAvatarNames, setFailedNpcAvatarNames] = useState<Set<string>>(() => new Set());
  const [imagePromptReviewItems, setImagePromptReviewItems] = useState<GameImagePromptReviewItem[]>([]);
  const [imagePromptReviewSubmitting, setImagePromptReviewSubmitting] = useState(false);
  const imagePromptReviewResolveRef = useRef<((overrides: GameImagePromptOverride[] | null) => void) | null>(null);
  const clearFailedNpcAvatars = useCallback(
    (names: Iterable<string>) => {
      const normalizedNames = new Set([...names].map(normalizeNpcName).filter(Boolean));
      if (normalizedNames.size === 0) return;
      setFailedNpcAvatarNames((current) => {
        let modified = false;
        const next = new Set(current);
        for (const name of normalizedNames) {
          if (next.delete(name)) modified = true;
        }
        return modified ? next : current;
      });
    },
    [normalizeNpcName],
  );

  const handleNpcPortraitLoadError = useCallback(
    (npcName: string) => {
      const normalizedName = normalizeNpcName(npcName);
      if (!normalizedName) return;
      setFailedNpcAvatarNames((current) => {
        if (current.has(normalizedName)) return current;
        return new Set(current).add(normalizedName);
      });
    },
    [normalizeNpcName],
  );

  const installGeneratedIllustration = useCallback(
    async (illustration: { tag: string; segment?: number }) => {
      void queryClient.invalidateQueries({ queryKey: galleryKeys.images(activeChatId) });
      await fetchManifest();
      if (illustration.segment !== undefined && illustration.segment > 0) {
        setPendingSegmentEffects((previous) => {
          const existingIndex = previous.findIndex((effect) => effect.segment === illustration.segment);
          if (existingIndex >= 0) {
            return previous.map((effect, index) =>
              index === existingIndex ? { ...effect, background: illustration.tag } : effect,
            );
          }
          return [...previous, { segment: illustration.segment!, background: illustration.tag }];
        });
        return;
      }
      useGameAssetStore.getState().setCurrentBackground(illustration.tag);
    },
    [activeChatId, fetchManifest, queryClient, setPendingSegmentEffects],
  );

  const openImagePromptReview = useCallback((items: GameImagePromptReviewItem[]) => {
    return new Promise<GameImagePromptOverride[] | null>((resolve) => {
      imagePromptReviewResolveRef.current = resolve;
      setImagePromptReviewSubmitting(false);
      setImagePromptReviewItems(items);
    });
  }, []);

  const closeImagePromptReview = useCallback((overrides: GameImagePromptOverride[] | null) => {
    const resolve = imagePromptReviewResolveRef.current;
    imagePromptReviewResolveRef.current = null;
    setImagePromptReviewSubmitting(false);
    setImagePromptReviewItems([]);
    resolve?.(overrides);
  }, []);

  useEffect(() => {
    return () => {
      const resolve = imagePromptReviewResolveRef.current;
      imagePromptReviewResolveRef.current = null;
      resolve?.(null);
    };
  }, []);

  const runGameAssetGeneration = useCallback(
    async (
      assetPayload: GameAssetGenerationPayload,
      options?: Pick<GameAssetGenerationOptions, "allowPromptReview">,
    ): Promise<GameAssetGenerationResult | null> => {
      const uiState = useUIStore.getState();
      const assetPromptSettings = assetPayload.imagePromptSettings;
      const payload: GameAssetGenerationPayload = {
        ...assetPayload,
        debugMode: uiState.debugMode,
        imageSizes: getConfiguredGameAssetImageSizes(),
        imagePromptSettings: {
          includeAppearances: assetPromptSettings?.includeAppearances ?? uiState.imagePromptIncludeAppearances,
          format: assetPromptSettings?.format ?? uiState.imagePromptFormat,
          styleProfileId: assetPromptSettings?.styleProfileId ?? null,
          styleProfiles: uiState.imageStyleProfiles as ImageStyleProfileSettings,
        },
      };

      if (options?.allowPromptReview !== false && uiState.reviewImagePromptsBeforeSend) {
        let preview: { items: GameImagePromptReviewItem[] } | undefined;
        try {
          preview = await withTimeout(
            () => gameApi.previewGeneratedAssets(payload) as Promise<{ items: GameImagePromptReviewItem[] }>,
            GAME_ASSET_PREVIEW_TIMEOUT_MS,
            () => {
              toast.error("Image prompt preview timed out. Continuing with the default prompts.");
            },
          );
        } catch (error) {
          if (isTimeoutError(error)) {
            preview = { items: [] };
          } else {
            throw error;
          }
        }

        if (preview.items.length > 0) {
          let overrides: GameImagePromptOverride[] | null | typeof IMAGE_PROMPT_REVIEW_TIMED_OUT | undefined;
          try {
            overrides = await withTimeout(
              () => openImagePromptReview(preview.items),
              GAME_ASSET_PROMPT_REVIEW_TIMEOUT_MS,
              () => {
                closeImagePromptReview(null);
                toast.error("Image prompt review timed out. Continuing with the default prompts.");
              },
            );
          } catch (error) {
            if (isTimeoutError(error)) {
              overrides = IMAGE_PROMPT_REVIEW_TIMED_OUT;
            } else {
              throw error;
            }
          }

          if (overrides === null || overrides === undefined) return null;
          if (overrides !== IMAGE_PROMPT_REVIEW_TIMED_OUT) {
            setImagePromptReviewSubmitting(true);
            payload.promptOverrides = overrides;
          }
        }
      }

      return await withTimeout(
        (signal) => gameApi.generateAssets(payload, signal),
        GAME_ASSET_GENERATION_TIMEOUT_MS,
        () => {
          toast.error("Image generation timed out. The scene will continue without generated assets.");
        },
      );
    },
    [closeImagePromptReview, openImagePromptReview],
  );

  const applyGeneratedAssets = useCallback(
    async (res: GameAssetGenerationResult) => {
      publishSessionChat(res.sessionChat);
      const nextBackground = res.generatedBackground ?? res.fallbackBackground;
      if (nextBackground) {
        await fetchManifest();
        useGameAssetStore.getState().setCurrentBackground(nextBackground);
      }
      if (res.generatedIllustration) {
        await installGeneratedIllustration(res.generatedIllustration);
      }
      if (res.generatedNpcAvatars?.length) {
        useGameModeStore.getState().patchNpcAvatars(res.generatedNpcAvatars);
        clearFailedNpcAvatars(res.generatedNpcAvatars.map((avatar) => avatar.name));
      }
    },
    [clearFailedNpcAvatars, fetchManifest, installGeneratedIllustration, publishSessionChat],
  );

  const resetAssetGenerationState = useCallback(() => {
    setAssetGenerationFailed(false);
    setPendingAssetGeneration(null);
    setAssetGenerationBlocksScene(false);
  }, []);

  const requestAssetGeneration = useCallback(
    async (assetPayload: GameAssetGenerationPayload, options?: GameAssetGenerationOptions) => {
      if (!gameImageGenerationEnabled) {
        resetAssetGenerationState();
        return null;
      }

      setPendingAssetGeneration(assetPayload);
      setAssetGenerationBlocksScene(options?.blocksScene === true);
      setAssetGenerationFailed(false);

      try {
        const res = await runGameAssetGeneration(assetPayload, { allowPromptReview: options?.allowPromptReview });

        setPendingAssetGeneration(null);
        setAssetGenerationBlocksScene(false);
        if (!res) return null;
        await applyGeneratedAssets(res);
        if (
          options?.showSuccessToast &&
          (res.generatedBackground || res.generatedIllustration || res.generatedNpcAvatars?.length)
        ) {
          toast.success("Missing assets regenerated.", { duration: 1800 });
        }

        return res;
      } catch {
        setAssetGenerationFailed(true);
        setAssetGenerationBlocksScene(false);
        return null;
      }
    },
    [applyGeneratedAssets, gameImageGenerationEnabled, resetAssetGenerationState, runGameAssetGeneration],
  );

  const retryAssetGeneration = useCallback(
    (assetPayload: GameAssetGenerationPayload | null | undefined, options?: { showSuccessToast?: boolean }) => {
      const retryPayload = pendingAssetGeneration ?? assetPayload;
      if (!retryPayload) return;
      void requestAssetGeneration(retryPayload, options);
    },
    [pendingAssetGeneration, requestAssetGeneration],
  );

  useEffect(() => {
    setFailedNpcAvatarNames(new Set());
    closeImagePromptReview(null);
    resetAssetGenerationState();
  }, [activeChatId, closeImagePromptReview, resetAssetGenerationState]);

  const imagePromptReviewModal = (
    <GameImagePromptReviewModal
      open={imagePromptReviewItems.length > 0}
      items={imagePromptReviewItems}
      isSubmitting={imagePromptReviewSubmitting}
      onCancel={() => closeImagePromptReview(null)}
      onConfirm={(overrides) => closeImagePromptReview(overrides)}
    />
  );

  return {
    applyGeneratedAssets,
    assetGenerationBlocksScene,
    assetGenerationFailed,
    clearFailedNpcAvatars,
    failedNpcAvatarNames,
    handleNpcPortraitLoadError,
    imagePromptReviewModal,
    installGeneratedIllustration,
    pendingAssetGeneration,
    requestAssetGeneration,
    resetAssetGenerationState,
    retryAssetGeneration,
    runGameAssetGeneration,
  };
}

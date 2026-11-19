import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { spriteApi, type SpriteOwnerType } from "../../../../../shared/api/image-generation-api";
import type {
  ImagePromptOverride,
  ImagePromptReviewItem,
} from "../../../../../shared/components/ui/ImagePromptReviewModal";
import { showConfirmDialog } from "../../../../../shared/lib/app-dialogs";
import { getErrorMessage } from "../../../../../shared/lib/error-message";
import { cropSpriteDataUrl, type SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  isDefaultImageGenerationConnection,
  type ImageGenerationConnectionOption,
} from "../../../../../shared/types/image-generation";
import type { SpriteCapabilities } from "../../../../../shared/types/sprite-capabilities";
import { setFrameEdge, ZERO_FRAME, type FrameEdge } from "../lib/frame-limits";
import {
  cleanSprites,
  requestSheet,
  runMatchedBatches,
  sheetFromReply,
  spritesFromReply,
  type GeneratedSheet,
  type GeneratedSprite,
  type GenerationPorts,
  type SheetReply,
} from "../lib/generation-run";
import {
  matchedBatchGrid,
  matchedOverallGrid,
  MATCHED_BATCH_SIZE,
  planMatchedBatches,
  type MatchedBatch,
} from "../lib/matched-batches";
import { recutSprites } from "../lib/recut";
import {
  buildGenerationBody,
  referenceImagesToSend,
  spriteNegativePrompt,
  type SpriteCleanupBody,
  type SpriteGenerationBody,
  type SpriteGenerationInput,
} from "../lib/request-bodies";
import { zeroSliceSettings, type SliceSettings } from "../lib/slice-geometry";
import {
  CLEANUP_AFTER_GENERATION_FAILED,
  CLEANUP_FAILED,
  FRAME_FAILED,
  GENERATION_FAILED,
  SAVE_FAILED,
  SLICE_FAILED,
  spriteErrorMessage,
} from "../lib/sprite-errors";
import {
  DEFAULT_SPRITE_COUNT,
  defaultPicks,
  gridForCount,
  spacedName,
  togglePick,
  type SpriteCount,
  type SpriteGrid,
  type SpriteType,
} from "../lib/sprite-lists";
import {
  matchedExpressionNames,
  MAX_MATCHED_NAMES,
  namesReplacingSaved,
  replaceSavedQuestion,
  savableName,
  type NameListKind,
} from "../lib/sprite-names";

const MAX_UPLOADS_WITH_AVATAR = 3;
const MAX_UPLOADS = 4;

export interface SpriteGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  /** The character or persona id. */
  entityId: string;
  /** Left out by the character tab, meaning "character". */
  entityKind?: SpriteOwnerType;
  initialSpriteType: SpriteType;
  /** The owner's saved sprite names that don't start with `full_`. */
  existingExpressionNames: string[];
  /** Every saved sprite name of the owner, `full_` ones included, so Save can ask before replacing one. */
  savedSpriteNames?: string[];
  defaultAppearance?: string;
  defaultAvatarUrl?: string | null;
  imageConnections: ImageGenerationConnectionOption[];
  spriteCapabilities?: SpriteCapabilities | null;
  /** Called after sprites were saved, so the tab refreshes its list. */
  onSpritesGenerated: () => void;
}

export type DialogStep = "setup" | "generating" | "review";

/** What the review step needs to know about the generation it shows. */
export interface GenerationInfo {
  type: SpriteType;
  matched: boolean;
  /** The names asked for: the picks cut to the grid, or the matched names. */
  names: string[];
  /** The review grid: the sheet's, or the overall one for matched batches. */
  grid: SpriteGrid;
  /** The grid the cut sliders follow: the sheet's, or a matched batch's of up to four names. */
  cutGrid: SpriteGrid;
  listKind: NameListKind;
}

interface PausedRun {
  batches: MatchedBatch[];
  batchIndex: number;
  template: Omit<SpriteGenerationInput, "expressions" | "grid">;
}

export interface FrameEditorState {
  spriteId: string;
  frame: SpriteFrameAdjustments;
}

interface PendingReview {
  items: ImagePromptReviewItem[];
  resolve: (overrides: ImagePromptOverride[] | null) => void;
}

function ownerKey(props: SpriteGenerationDialogProps): string {
  return JSON.stringify([
    props.entityId,
    props.entityKind ?? null,
    props.defaultAvatarUrl ?? null,
    props.defaultAppearance ?? null,
  ]);
}

function isGptImage2(model: string | null | undefined): boolean {
  const normalized = (model ?? "").trim().toLowerCase();
  return normalized === "gpt-image-2" || normalized.startsWith("gpt-image-2-");
}

function saveFailureMessage(error: unknown, expression: string, saved: number, total: number): string {
  const reason = getErrorMessage(error, "");
  const failed = reason ? `Couldn't save ${expression}: ${reason}` : `Couldn't save ${expression}. Try again.`;
  if (saved > 0) return `Saved ${saved} of ${total}. ${failed}`;
  return reason ? failed : SAVE_FAILED;
}

/** Everything the sprite generation dialog holds and does. The callers keep it mounted, so this state lives between opens. */
export function useSpriteGeneration(props: SpriteGenerationDialogProps) {
  const { open, entityId, defaultAvatarUrl, imageConnections, spriteCapabilities } = props;
  const ownerType: SpriteOwnerType = props.entityKind ?? "character";

  // Setup
  const [spriteType, setSpriteType] = useState<SpriteType>(props.initialSpriteType);
  const [count, setCount] = useState<SpriteCount>(DEFAULT_SPRITE_COUNT);
  const [picks, setPicks] = useState<string[]>(() => defaultPicks(props.initialSpriteType, DEFAULT_SPRITE_COUNT));
  const [matchExisting, setMatchExisting] = useState(false);
  const [preferTransparent, setPreferTransparentState] = useState(false);
  const [transparentBackground, setTransparentBackgroundState] = useState(false);
  const [appearance, setAppearance] = useState(props.defaultAppearance ?? "");
  const [uploads, setUploads] = useState<string[]>([]);
  const [useAvatar, setUseAvatarState] = useState(Boolean(props.defaultAvatarUrl));
  const [connectionPick, setConnectionPick] = useState<string | null>(null);
  const [cleanupStrength, setCleanupStrength] = useState(35);

  // Session
  const [step, setStep] = useState<DialogStep>("setup");
  const [sprites, setSprites] = useState<GeneratedSprite[]>([]);
  const [sheets, setSheets] = useState<GeneratedSheet[]>([]);
  const [generation, setGeneration] = useState<GenerationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState<PausedRun | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [slice, setSlice] = useState<SliceSettings>(() => zeroSliceSettings(null));
  const [cleanupApplied, setCleanupApplied] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [slicing, setSlicing] = useState(false);
  const [frameEditor, setFrameEditor] = useState<FrameEditorState | null>(null);
  const [framing, setFraming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);

  // A run whose owner or setup was replaced since it started must not land its results.
  const runToken = useRef(0);
  // Review-step work (cleanup, cuts, frame, save) started for an earlier owner must not land on the current one.
  const ownerEpoch = useRef(0);
  const idCounter = useRef(0);
  const cleanupSettings = useRef({ enabled: transparentBackground, strength: cleanupStrength });
  cleanupSettings.current = { enabled: transparentBackground, strength: cleanupStrength };
  const pendingReviewRef = useRef<PendingReview | null>(null);
  pendingReviewRef.current = pendingReview;

  // Each time the dialog opens, the settings beneath the results reset; the step and results stay.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSpriteType(props.initialSpriteType);
      setCount(DEFAULT_SPRITE_COUNT);
      setPicks(defaultPicks(props.initialSpriteType, DEFAULT_SPRITE_COUNT));
      setMatchExisting(false);
      setPreferTransparentState(false);
      setTransparentBackgroundState(false);
    }
  }

  // A new owner starts over (the first owner was set up by the initial state).
  const currentOwner = ownerKey(props);
  const [owner, setOwner] = useState(currentOwner);
  if (owner !== currentOwner) {
    setOwner(currentOwner);
    runToken.current += 1;
    ownerEpoch.current += 1;
    // An open prompt review belonged to the old owner's run: cancel it so that run sends nothing more.
    pendingReviewRef.current?.resolve(null);
    setAppearance(props.defaultAppearance ?? "");
    setUploads([]);
    setUseAvatarState(Boolean(props.defaultAvatarUrl));
    setStep("setup");
    setSprites([]);
    setSheets([]);
    setGeneration(null);
    setPaused(null);
    setProgress(null);
    setSlice(zeroSliceSettings(null));
    setCleanupApplied(false);
    setFrameEditor(null);
    setMatchExisting(false);
    setPreferTransparentState(false);
    setTransparentBackgroundState(false);
    setError(null);
  }

  // When the dialog goes away with the prompt review open, the review counts as cancelled.
  useEffect(() => () => pendingReviewRef.current?.resolve(null), []);

  const connection = useMemo(
    () =>
      imageConnections.find((item) => item.id === connectionPick) ??
      imageConnections.find(isDefaultImageGenerationConnection) ??
      imageConnections[0] ??
      null,
    [connectionPick, imageConnections],
  );

  const allMatchedNames = useMemo(
    () => matchedExpressionNames(props.existingExpressionNames),
    [props.existingExpressionNames],
  );
  const matchedNames = allMatchedNames.slice(0, MAX_MATCHED_NAMES);
  const matchedMode = spriteType === "full-body" && matchExisting && matchedNames.length > 0;
  const grid = gridForCount(count);
  const capacity = grid.cols * grid.rows;
  const avatarOn = useAvatar && Boolean(defaultAvatarUrl);
  const generationUnavailable = spriteCapabilities?.spriteGenerationAvailable === false;
  const unavailableReason = spriteCapabilities?.reason || "Sprite generation is unavailable on this platform.";
  const names = matchedMode ? matchedNames : picks.slice(0, capacity);

  /** Why Generate can't run yet, or null when it can. */
  const missing = generationUnavailable
    ? unavailableReason
    : !connection
      ? "Add an image generation connection to generate."
      : names.length === 0
        ? `Pick at least one ${spriteType === "full-body" ? "pose" : "expression"} to generate.`
        : appearance.trim() === ""
          ? "Describe their appearance to generate."
          : null;

  const chooseType = (type: SpriteType) => {
    setSpriteType(type);
    setPicks(defaultPicks(type, count));
    if (type === "expressions") setMatchExisting(false);
  };

  const chooseCount = (next: SpriteCount) => {
    setCount(next);
    setPicks(defaultPicks(spriteType, next));
  };

  const togglePickName = (name: string) => setPicks((current) => togglePick(current, name, capacity));

  const setPreferTransparent = (value: boolean) => {
    setPreferTransparentState(value);
    setTransparentBackgroundState(value);
  };

  const setUseAvatar = (value: boolean) => {
    setUseAvatarState(value);
    if (value) setUploads((current) => current.slice(0, MAX_UPLOADS_WITH_AVATAR));
  };

  const addUpload = (dataUrl: string) => setUploads((current) => [...current, dataUrl]);
  const removeUpload = (index: number) => setUploads((current) => current.filter((_, position) => position !== index));

  const review = useCallback(
    (items: ImagePromptReviewItem[]) =>
      new Promise<ImagePromptOverride[] | null>((resolve) => {
        setPendingReview({
          items,
          resolve: (overrides) => {
            setPendingReview(null);
            resolve(overrides);
          },
        });
      }),
    [],
  );

  const ports = (): GenerationPorts => ({
    reviewPrompts: useUIStore.getState().reviewImagePromptsBeforeSend,
    preview: (body: SpriteGenerationBody) => spriteApi.generateSheetPreview<{ items?: ImagePromptReviewItem[] }>(body),
    generate: (body: SpriteGenerationBody) => spriteApi.generateSheet<SheetReply>(body),
    review,
    cleanup: (body: SpriteCleanupBody) =>
      spriteApi.cleanup<{ cells?: Array<{ expression?: string; base64?: string | null }> }>(body),
    nextId: () => {
      idCounter.current += 1;
      return `sprite-${idCounter.current}`;
    },
  });

  const runBatches = async (
    token: number,
    run: PausedRun,
    collected: { sprites: GeneratedSprite[]; sheets: GeneratedSheet[] },
  ) => {
    const result = await runMatchedBatches({
      batches: run.batches,
      startIndex: run.batchIndex,
      template: run.template,
      collected,
      ports: ports(),
      cleanupSettings: () => cleanupSettings.current,
      onProgress: (line) => {
        if (runToken.current === token) setProgress(line);
      },
    });
    if (runToken.current !== token) return;
    setSprites(result.sprites);
    setSheets(result.sheets);
    if (result.cleaned) setCleanupApplied(true);
    if (result.failure) {
      setError(result.failure.message);
      setPaused({ ...run, batchIndex: result.failure.batchIndex });
    } else {
      setError(null);
      setPaused(null);
    }
    setStep("review");
  };

  const runSingle = async (token: number, body: SpriteGenerationBody, type: SpriteType, sheetGrid: SpriteGrid) => {
    const runPorts = ports();
    try {
      const reply = await requestSheet(body, runPorts);
      if (runToken.current !== token) return;
      if (!reply) {
        setStep("setup");
        return;
      }
      const sheet = sheetFromReply(reply, "Generated sheet", sheetGrid);
      let generated = spritesFromReply(reply, sheet ? 0 : null, runPorts.nextId);
      const notes: string[] = [];
      const failed = reply.failedExpressions ?? [];
      if (failed.length > 0) {
        const failedNames = failed.map((item) => spacedName(item.expression)).join(", ");
        notes.push(
          `Some ${type === "full-body" ? "poses" : "expressions"} didn't generate: ${failedNames}. Generate again to retry them.`,
        );
      }
      let cleaned = false;
      const cleanup = cleanupSettings.current;
      if (cleanup.enabled) {
        try {
          generated = await cleanSprites(generated, cleanup.strength, runPorts.cleanup);
          cleaned = true;
        } catch {
          // The paid pictures stay; the person can run Apply cleanup again.
          notes.push(CLEANUP_AFTER_GENERATION_FAILED);
        }
        if (runToken.current !== token) return;
      }
      setSprites(generated);
      setSheets(sheet ? [sheet] : []);
      setCleanupApplied(cleaned);
      setError(notes.length > 0 ? notes.join(" ") : null);
      setStep("review");
    } catch (caught) {
      if (runToken.current !== token) return;
      setSprites([]);
      setSheets([]);
      setError(spriteErrorMessage(caught, GENERATION_FAILED));
      setStep("setup");
    }
  };

  const generate = () => {
    if (missing || !connection) return;
    runToken.current += 1;
    const token = runToken.current;
    const type = spriteType;
    const matched = matchedMode;
    const generationNames = [...names];
    const reviewGrid = matched ? matchedOverallGrid(generationNames.length) : grid;
    const cutGrid = matched ? matchedBatchGrid(Math.min(generationNames.length, MATCHED_BATCH_SIZE)) : grid;
    const { imageStyleProfiles } = useUIStore.getState();
    const template = {
      connectionId: connection.id,
      appearance,
      referenceImages: referenceImagesToSend(defaultAvatarUrl, useAvatar, uploads),
      spriteType: type,
      matched,
      nativeTransparentPng: preferTransparent,
      negativePrompt: spriteNegativePrompt(type, matched, imageStyleProfiles),
    };

    setError(null);
    setSprites([]);
    setSheets([]);
    setPaused(null);
    setProgress(null);
    setCleanupApplied(false);
    // Only "Prefer transparent PNG" turns on cleanup after generation.
    setTransparentBackgroundState(preferTransparent);
    cleanupSettings.current = { enabled: preferTransparent, strength: cleanupStrength };
    setFrameEditor(null);
    setSlice(zeroSliceSettings(cutGrid));
    setGeneration({
      type,
      matched,
      names: generationNames,
      grid: reviewGrid,
      cutGrid,
      listKind: type === "full-body" && !matched ? "poses" : "expressions",
    });
    setStep("generating");

    if (matched) {
      void runBatches(
        token,
        { batches: planMatchedBatches(generationNames), batchIndex: 0, template },
        { sprites: [], sheets: [] },
      );
    } else {
      void runSingle(token, buildGenerationBody({ ...template, expressions: generationNames, grid }), type, grid);
    }
  };

  const retryBatch = () => {
    if (!paused || generationUnavailable || !connection) return;
    runToken.current += 1;
    const token = runToken.current;
    setError(null);
    setFrameEditor(null);
    setStep("generating");
    void runBatches(token, paused, { sprites, sheets });
  };

  const clearResults = () => {
    setSprites([]);
    setSheets([]);
    setPaused(null);
    setProgress(null);
    setFrameEditor(null);
  };

  /** "Back to setup": drops the results without sending anything; the setup is kept. */
  const backToSetup = () => {
    runToken.current += 1;
    clearResults();
    setGeneration(null);
    setCleanupApplied(false);
    setTransparentBackgroundState(preferTransparent);
    setSlice(zeroSliceSettings(null));
    setError(null);
    setStep("setup");
  };

  const renameSprite = (id: string, name: string) =>
    setSprites((current) => current.map((sprite) => (sprite.id === id ? { ...sprite, name } : sprite)));

  const toggleSelected = (id: string) =>
    setSprites((current) =>
      current.map((sprite) => (sprite.id === id ? { ...sprite, selected: !sprite.selected } : sprite)),
    );

  const showOriginals = () => {
    setSprites((current) => current.map((sprite) => ({ ...sprite, shown: sprite.original })));
    setCleanupApplied(false);
  };

  const setTransparentBackground = (value: boolean) => {
    setTransparentBackgroundState(value);
    if (!value) showOriginals();
  };

  /** A check that work started now still belongs to the same run and owner when it finishes. */
  const startWork = () => {
    const run = runToken.current;
    const ownerAt = ownerEpoch.current;
    return () => runToken.current === run && ownerEpoch.current === ownerAt;
  };

  const applyCleanup = async () => {
    if (cleaning || slicing || framing || sprites.length === 0) return;
    const stillCurrent = startWork();
    setCleaning(true);
    try {
      const cleaned = await cleanSprites(sprites, cleanupStrength, ports().cleanup);
      // A late reply lands only while the box is still on, and only on sprites whose picture is still the one sent.
      if (!stillCurrent() || !cleanupSettings.current.enabled) return;
      const sent = new Map(cleaned.map((sprite) => [sprite.id, sprite]));
      setSprites((current) =>
        current.map((sprite) => {
          const match = sent.get(sprite.id);
          return match && match.original === sprite.original ? { ...sprite, shown: match.shown } : sprite;
        }),
      );
      setCleanupApplied(true);
    } catch (caught) {
      if (stillCurrent()) setError(getErrorMessage(caught, CLEANUP_FAILED));
    } finally {
      setCleaning(false);
    }
  };

  const applySlice = async () => {
    if (slicing || cleaning) return;
    const stillCurrent = startWork();
    setSlicing(true);
    try {
      // The new picture becomes both the original and the shown one, so frames and cleanup are gone.
      const pictures = await recutSprites(sprites, sheets, slice);
      if (!stillCurrent()) return;
      setSprites((current) =>
        current.map((sprite) => {
          const picture = pictures.get(sprite.id);
          return picture ? { ...sprite, original: picture, shown: picture } : sprite;
        }),
      );
      setCleanupApplied(false);
      setFrameEditor(null);
    } catch (caught) {
      if (stillCurrent()) setError(spriteErrorMessage(caught, SLICE_FAILED));
    } finally {
      setSlicing(false);
    }
  };

  const openFrameEditor = (spriteId: string) => {
    setFrameEditor({ spriteId, frame: ZERO_FRAME });
    setError(null);
  };

  const setFrameValue = (edge: FrameEdge, value: number) =>
    setFrameEditor((current) => (current ? { ...current, frame: setFrameEdge(current.frame, edge, value) } : current));

  const applyFrame = async () => {
    const editor = frameEditor;
    const sprite = editor ? sprites.find((item) => item.id === editor.spriteId) : undefined;
    if (!editor || !sprite || framing || cleaning) return;
    const stillCurrent = startWork();
    setFraming(true);
    try {
      const original = await cropSpriteDataUrl(sprite.original, editor.frame);
      const shown = sprite.shown !== sprite.original ? await cropSpriteDataUrl(sprite.shown, editor.frame) : original;
      if (!stillCurrent()) return;
      setSprites((current) =>
        current.map((item) =>
          item.id === sprite.id && item.original === sprite.original ? { ...item, original, shown } : item,
        ),
      );
      setFrameEditor(null);
    } catch (caught) {
      if (stillCurrent()) setError(getErrorMessage(caught, FRAME_FAILED));
    } finally {
      setFraming(false);
    }
  };

  const toSave = sprites.filter((sprite) => sprite.selected && savableName(sprite.name, spriteType) !== null);

  const save = async () => {
    if (saving || toSave.length === 0) return;
    const type = spriteType;
    const stillCurrent = startWork();
    setSaving(true);
    const replacing = namesReplacingSaved(
      toSave.map((sprite) => savableName(sprite.name, type) ?? ""),
      props.savedSpriteNames ?? [],
    );
    if (
      replacing.length > 0 &&
      !(await showConfirmDialog({
        title: "Replace saved sprites?",
        message: replaceSavedQuestion(replacing),
        confirmLabel: "Replace",
        tone: "destructive",
      }))
    ) {
      setSaving(false);
      return;
    }
    // A new owner (or a new run) while the question was open: nothing is saved for the old one.
    if (!stillCurrent()) {
      setSaving(false);
      return;
    }
    let saved = 0;
    try {
      for (const sprite of toSave) {
        const expression = savableName(sprite.name, type) ?? "";
        try {
          await spriteApi.upload(entityId, { expression, image: sprite.shown }, { ownerType });
        } catch (caught) {
          if (!stillCurrent()) return;
          // The ones saved before it stay saved, so the tab's list refreshes.
          if (saved > 0) props.onSpritesGenerated();
          setError(saveFailureMessage(caught, expression, saved, toSave.length));
          return;
        }
        saved += 1;
      }
      if (!stillCurrent()) return;
      props.onSpritesGenerated();
      props.onClose();
      clearResults();
      setGeneration(null);
      setCleanupApplied(false);
      setError(null);
      setStep("setup");
    } finally {
      setSaving(false);
    }
  };

  return {
    // setup
    spriteType,
    chooseType,
    count,
    chooseCount,
    grid,
    picks: picks.slice(0, capacity),
    togglePickName,
    matchExisting,
    setMatchExisting,
    allMatchedNames,
    matchedNames,
    matchedMode,
    preferTransparent,
    setPreferTransparent,
    showGptImage2Note: preferTransparent && isGptImage2(connection?.model),
    appearance,
    setAppearance,
    avatarUrl: defaultAvatarUrl ?? null,
    useAvatar,
    setUseAvatar,
    avatarOn,
    uploads,
    canAddUpload: uploads.length < (avatarOn ? MAX_UPLOADS_WITH_AVATAR : MAX_UPLOADS),
    addUpload,
    removeUpload,
    connections: imageConnections,
    connection,
    setConnectionPick,
    generationUnavailable,
    unavailableReason,
    missing,
    generate,
    // session
    step,
    error,
    progress,
    generation,
    sprites,
    sheets,
    paused: paused
      ? {
          batchIndex: paused.batchIndex,
          total: paused.batches.length,
          names: paused.batches[paused.batchIndex]?.names ?? [],
        }
      : null,
    retryBatch,
    canRetry: !generationUnavailable && Boolean(connection),
    backToSetup,
    renameSprite,
    toggleSelected,
    slice,
    setSlice,
    resetSlice: () => setSlice(zeroSliceSettings(generation?.cutGrid ?? null)),
    applySlice,
    slicing,
    transparentBackground,
    setTransparentBackground,
    cleanupStrength,
    setCleanupStrength,
    cleanupApplied,
    cleaning,
    applyCleanup,
    showOriginals,
    cleanupEngineInstalled: spriteCapabilities?.cleanupEngine?.installed !== false,
    cleanupEngineReason: spriteCapabilities?.cleanupEngine?.reason || "Sprite cleanup is not available.",
    frameEditor,
    openFrameEditor,
    closeFrameEditor: () => setFrameEditor(null),
    resetFrame: () => setFrameEditor((current) => (current ? { ...current, frame: ZERO_FRAME } : current)),
    setFrameValue,
    applyFrame,
    framing,
    saveCount: toSave.length,
    save,
    saving,
    pendingReview,
  };
}

export type SpriteGenerationController = ReturnType<typeof useSpriteGeneration>;

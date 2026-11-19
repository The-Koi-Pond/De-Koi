import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../../../../../shared/components/ui/Modal";
import { useDialogStore } from "../../../../../shared/stores/dialog.store";
import { drawPicture, pictureToPngDataUrl } from "../browser/picture-canvas";
import { useCleanupPicture } from "../hooks/use-cleanup-picture";
import { useHistoryShortcuts } from "../hooks/use-history-shortcuts";
import { useStageGestures } from "../hooks/use-stage-gestures";
import { useStageView } from "../hooks/use-stage-view";
import { CLEANUP_TEXT, idleHint, readoutText, type CleanupTool } from "../lib/cleanup-text";
import { DEFAULT_BRUSH_CONTROLS, type BrushControls } from "../lib/tool-settings";
import { DEFAULT_WAND_SETTINGS, type WandSettings } from "../lib/wand";
import { CleanupFooter } from "./CleanupFooter";
import { CleanupSettings, type PreviewBackground } from "./CleanupSettings";
import { CleanupStage } from "./CleanupStage";
import { CleanupToolbar } from "./CleanupToolbar";
import { saveFormatNote, useDiscardQuestion, type SavedSpriteEditorProps } from "./saved-sprite-editor";

/**
 * The cleanup editor for a saved sprite: a wand that removes connected background and brushes that clean, erase,
 * paint, restore and smooth. It hands the edited picture to `onApply` as a canvas PNG; the Sprites tab saves it.
 * Every open starts fresh. Spec: docs/provenance/sprite-editors.md, "Cleanup editor".
 */
export function SpriteCleanupEditor({ imageUrl, label, filename, applying, onApply, onClose }: SavedSpriteEditorProps) {
  const session = useCleanupPicture(imageUrl);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const view = useStageView(stageRef, session.picture?.original ?? null);
  const [tool, setTool] = useState<CleanupTool>("wand");
  const [wand, setWand] = useState<WandSettings>(DEFAULT_WAND_SETTINGS);
  const [brush, setBrush] = useState<BrushControls>(DEFAULT_BRUSH_CONTROLS);
  const [picking, setPicking] = useState(false);
  const [background, setBackground] = useState<PreviewBackground>("dark");
  const [showingOriginal, setShowingOriginal] = useState(false);

  const picture = session.picture;
  const busy = session.phase !== "ready" || applying;
  const canUndo = (picture?.history.undo.length ?? 0) > 0;
  const canRedo = (picture?.history.redo.length ?? 0) > 0;
  const hasChanges = picture?.hasChanges ?? false;

  const gestures = useStageGestures({
    stageRef,
    canvasRef,
    pictureRef: session.pictureRef,
    blocked: busy || showingOriginal,
    tool,
    wand,
    brush,
    picking,
    onPicked: (color) => {
      setBrush((controls) => ({ ...controls, color }));
      setPicking(false);
    },
    commitChange: session.commitChange,
    setStatus: session.setStatus,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !picture) return;
    drawPicture(canvas, showingOriginal ? picture.original : picture.current);
  }, [picture, showingOriginal]);

  // Undo, Redo and Reset wait while a stroke or pan is in progress: its end would otherwise write over them.
  const historyLocked = busy || gestures.gestureActive;
  const whenIdle = (action: () => void) => () => {
    if (!gestures.isGestureActive()) action();
  };
  const undo = whenIdle(session.undo);
  const redo = whenIdle(session.redo);
  const reset = whenIdle(session.reset);

  // The shortcuts also stay away from any dialog on top of this one, like the discard question.
  const { asking, confirmDiscard } = useDiscardQuestion(label);
  const appDialogOpen = useDialogStore((state) => state.dialog !== null);
  useHistoryShortcuts({
    enabled: !historyLocked && !asking && !appDialogOpen,
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    ownDialog: () => editorRef.current?.closest("[role='dialog']") ?? null,
  });

  const changeTool = (next: CleanupTool) => {
    setTool(next);
    setPicking(false);
  };

  const changeBrush = (change: Partial<BrushControls>) => {
    setBrush((controls) => ({ ...controls, ...change }));
    if (change.color !== undefined || change.paintMode === "restore") setPicking(false);
  };

  const togglePick = () => {
    const next = !picking;
    setPicking(next);
    session.setStatus(next ? CLEANUP_TEXT.pickOn : CLEANUP_TEXT.pickOff);
  };

  const resetWand = () => {
    setWand(DEFAULT_WAND_SETTINGS);
    session.setStatus(CLEANUP_TEXT.wandDefaults);
  };

  const apply = async () => {
    const editing = session.pictureRef.current;
    if (!editing) return;
    try {
      await onApply(pictureToPngDataUrl(editing.current));
    } catch {
      session.setError(CLEANUP_TEXT.saveFailed);
    }
  };

  const requestClose = useCallback(async () => {
    if (session.pictureRef.current?.hasChanges && !(await confirmDiscard())) return;
    onClose();
  }, [confirmDiscard, onClose, session.pictureRef]);

  return (
    <Modal open onClose={() => void requestClose()} title={`Clean up ${label}`} width="max-w-6xl">
      <div ref={editorRef} className="flex h-[min(44rem,calc(100dvh-9rem))] min-h-0 flex-col gap-3">
        <CleanupToolbar
          tool={tool}
          zoom={view.zoom}
          disabled={busy}
          onToolChange={changeTool}
          onZoomIn={view.zoomIn}
          onZoomOut={view.zoomOut}
          onFit={view.fit}
        />
        <CleanupSettings
          tool={tool}
          wand={wand}
          brush={brush}
          picking={picking}
          background={background}
          disabled={busy}
          onWandChange={(change) => setWand((settings) => ({ ...settings, ...change }))}
          onWandDefaults={resetWand}
          onBrushChange={changeBrush}
          onTogglePick={togglePick}
          onBackgroundChange={setBackground}
        />
        <CleanupStage
          stageRef={stageRef}
          canvasRef={canvasRef}
          label={label}
          phase={session.phase}
          picture={picture?.current ?? null}
          zoom={view.zoom}
          background={background}
          tool={tool}
          brushSize={brush.size}
          picking={picking}
          hover={gestures.hover}
          panning={gestures.panning}
          handlers={gestures.stageHandlers}
          onZoomWheel={view.zoomByWheel}
          onRetry={session.reload}
        />
        <CleanupFooter
          status={session.status ?? idleHint(tool, brush.paintMode)}
          error={session.error}
          note={saveFormatNote(filename)}
          readout={readoutText(gestures.hover)}
          canUndo={canUndo}
          canRedo={canRedo}
          hasChanges={hasChanges}
          busy={busy}
          historyLocked={historyLocked}
          applying={applying}
          onUndo={undo}
          onRedo={redo}
          onReset={reset}
          onShowOriginal={setShowingOriginal}
          onCancel={() => void requestClose()}
          onApply={() => void apply()}
        />
      </div>
    </Modal>
  );
}

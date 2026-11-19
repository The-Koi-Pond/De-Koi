import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { SpriteGenerationController } from "../hooks/use-sprite-generation";
import type { GeneratedSprite } from "../lib/generation-run";
import { spacedName, type SpriteType } from "../lib/sprite-lists";
import { listFormName, nameOptions, saveSpriteName } from "../lib/sprite-names";
import { CleanupBar } from "./CleanupBar";
import { CutPanel } from "./CutPanel";
import { errorBanner, hintText, primaryButton, secondaryButton, smallButton } from "./dialog-styles";
import { FrameEditor } from "./FrameEditor";
import { SpriteTile } from "./SpriteTile";

/** Narrow screens get at most two columns; wider ones follow the generation grid. */
const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

const COUNT_WORDS: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four" };

/** A warning per sprite whose save name another kept sprite also has: only the last one saved stays. */
function duplicateWarnings(sprites: readonly GeneratedSprite[], type: SpriteType): Map<string, string> {
  const groups = new Map<string, GeneratedSprite[]>();
  for (const sprite of sprites) {
    if (!sprite.selected || sprite.name.trim() === "") continue;
    const name = saveSpriteName(sprite.name, type);
    groups.set(name, [...(groups.get(name) ?? []), sprite]);
  }
  const warnings = new Map<string, string>();
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    const count = COUNT_WORDS[group.length] ?? String(group.length);
    const message = `${count} sprites are named ${spacedName(listFormName(name))}; only the last one will be kept.`;
    for (const sprite of group) warnings.set(sprite.id, message);
  }
  return warnings;
}

function sheetsSummary(sheetCount: number, single: boolean): string {
  if (sheetCount > 1) return `View ${sheetCount} generated batch sheets`;
  return single ? "View generated source image" : "View full generated sheet";
}

/** The review step: fix the cuts, frame and clean up each sprite, name them and save. */
export function ReviewStep({ dialog }: { dialog: SpriteGenerationController }) {
  const [confirmingBack, setConfirmingBack] = useState(false);
  const generation = dialog.generation;
  const grid = generation?.grid ?? { cols: 1, rows: 1 };
  const single = grid.cols * grid.rows === 1;
  const hasSheet = dialog.sprites.some((sprite) => sprite.sheetIndex !== null);
  const sharedOptions = nameOptions(generation?.names ?? [], generation?.listKind ?? "expressions");
  const warnings = duplicateWarnings(dialog.sprites, dialog.spriteType);
  const selectedCount = dialog.sprites.filter((sprite) => sprite.selected).length;
  const noun = generation?.matched ? "full-body expressions" : generation?.type === "full-body" ? "poses" : "sprites";
  const framed = dialog.frameEditor
    ? dialog.sprites.find((sprite) => sprite.id === dialog.frameEditor?.spriteId)
    : null;

  const goBack = () => {
    if (dialog.sprites.length > 0) {
      setConfirmingBack(true);
      return;
    }
    dialog.backToSetup();
  };

  return (
    <div className="space-y-4 text-sm text-[var(--foreground)]">
      {dialog.error && (
        <p role="alert" className={errorBanner}>
          {dialog.error}
        </p>
      )}

      {dialog.paused && (
        <section className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 className="text-sm font-semibold">
            Batch {dialog.paused.batchIndex + 1} of {dialog.paused.total} paused
          </h3>
          <p className="text-xs">{dialog.paused.names.map(spacedName).join(", ")}</p>
          <p className={hintText}>
            The batch already retried once automatically. Retry it here when the provider is ready; successful batches
            above are preserved.
          </p>
          <button type="button" onClick={dialog.retryBatch} disabled={!dialog.canRetry} className={smallButton}>
            Retry batch
          </button>
        </section>
      )}

      {dialog.sheets.length > 0 && (
        <details className="rounded-md border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            {sheetsSummary(dialog.sheets.length, single)}
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {dialog.sheets.map((sheet) => (
              <figure key={sheet.label} className="space-y-1">
                <img
                  src={sheet.src}
                  alt={sheet.label}
                  className="max-h-72 rounded border border-[var(--border)] object-contain"
                />
                <figcaption className={hintText}>
                  {sheet.label} · {sheet.grid.cols}×{sheet.grid.rows}
                </figcaption>
              </figure>
            ))}
          </div>
        </details>
      )}

      {hasSheet && !single && (
        <CutPanel
          settings={dialog.slice}
          sheetCount={dialog.sheets.length}
          busy={dialog.slicing}
          onChange={dialog.setSlice}
          onReset={dialog.resetSlice}
          onApply={() => void dialog.applySlice()}
        />
      )}

      <CleanupBar dialog={dialog} />

      {dialog.frameEditor && framed && (
        <FrameEditor
          name={spacedName(framed.name)}
          picture={framed.shown}
          frame={dialog.frameEditor.frame}
          busy={dialog.framing}
          onChange={dialog.setFrameValue}
          onReset={dialog.resetFrame}
          onApply={() => void dialog.applyFrame()}
          onClose={dialog.closeFrameEditor}
        />
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Review & label {noun} ({selectedCount} selected)
        </h3>
        <p className={hintText}>
          Click an item to toggle selection. Assign or edit names as needed. Only selected items will be saved.
        </p>
        <ul className={`grid gap-2 ${GRID_COLUMNS[Math.min(4, Math.max(1, grid.cols))]}`}>
          {dialog.sprites.map((sprite, index) => (
            <SpriteTile
              key={sprite.id}
              sprite={sprite}
              index={index}
              sharedOptions={sharedOptions}
              duplicateWarning={warnings.get(sprite.id) ?? null}
              framing={dialog.frameEditor?.spriteId === sprite.id}
              onToggle={() => dialog.toggleSelected(sprite.id)}
              onRename={(name) => dialog.renameSprite(sprite.id, name)}
              onFrame={() => dialog.openFrameEditor(sprite.id)}
            />
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)]/40 pt-3">
        {confirmingBack ? (
          <>
            <span className="mr-auto text-xs">
              Discard these {dialog.sprites.length} sprite{dialog.sprites.length === 1 ? "" : "s"}?
            </span>
            <button type="button" onClick={() => setConfirmingBack(false)} className={secondaryButton}>
              Keep them
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingBack(false);
                dialog.backToSetup();
              }}
              className={secondaryButton}
            >
              Discard
            </button>
          </>
        ) : (
          <button type="button" onClick={goBack} className={secondaryButton}>
            Back to setup
          </button>
        )}
        <button
          type="button"
          onClick={() => void dialog.save()}
          disabled={dialog.saving || dialog.saveCount === 0}
          className={primaryButton}
        >
          {dialog.saving && <Loader2 size="0.875rem" className="animate-spin" aria-hidden="true" />}
          {dialog.saving ? "Saving…" : `Save ${dialog.saveCount} sprite${dialog.saveCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

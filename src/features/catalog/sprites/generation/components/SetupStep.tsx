import { useId } from "react";

import { isDefaultImageGenerationConnection } from "../../../../../shared/types/image-generation";
import type { SpriteGenerationController } from "../hooks/use-sprite-generation";
import type { SpriteType } from "../lib/sprite-lists";
import {
  choiceButton,
  errorBanner,
  fieldClass,
  hintText,
  primaryButton,
  secondaryButton,
  sectionLabel,
} from "./dialog-styles";
import { ReferencePictures } from "./ReferencePictures";
import { MatchedPanel, PickPanel } from "./SpritePicks";

const TYPES: Array<{ type: SpriteType; label: string }> = [
  { type: "expressions", label: "Expressions (portrait)" },
  { type: "full-body", label: "Full-body" },
];

function generateLabel(dialog: SpriteGenerationController): string {
  if (dialog.matchedMode) return "Generate matched batches";
  const single = dialog.grid.cols * dialog.grid.rows === 1;
  if (dialog.spriteType === "full-body") return single ? "Generate pose" : "Generate pose sheet";
  return single ? "Generate sprite" : "Generate sheet";
}

/** The setup step: what to draw, with which connection, from which description and pictures. */
export function SetupStep({ dialog, onCancel }: { dialog: SpriteGenerationController; onCancel: () => void }) {
  const typeId = useId();
  const connectionId = useId();
  const appearanceId = useId();
  const missingId = useId();
  // The unavailable note above already says why; other gaps are named under the button.
  const showMissing = Boolean(dialog.missing) && !dialog.generationUnavailable;
  const showMatchBox = dialog.spriteType === "full-body" && dialog.allMatchedNames.length > 0;

  return (
    <div className="space-y-4 text-sm text-[var(--foreground)]">
      <div role="radiogroup" aria-labelledby={typeId} className="flex gap-2">
        <span id={typeId} className="sr-only">
          Sprite type
        </span>
        {TYPES.map((option) => (
          <button
            key={option.type}
            type="button"
            role="radio"
            aria-checked={dialog.spriteType === option.type}
            onClick={() => dialog.chooseType(option.type)}
            className={`${choiceButton(dialog.spriteType === option.type)} flex-1`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {dialog.error && (
        <p role="alert" className={errorBanner}>
          {dialog.error}
        </p>
      )}
      {dialog.generationUnavailable && (
        <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          {dialog.unavailableReason}
        </p>
      )}

      <section className="space-y-1.5">
        <label htmlFor={connectionId} className={sectionLabel}>
          Image generation connection
        </label>
        {dialog.connections.length === 0 ? (
          <p className={hintText}>
            No image generation connections found. Add one in Settings → Connections with the &quot;Image
            Generation&quot; provider type.
          </p>
        ) : (
          <select
            id={connectionId}
            value={dialog.connection?.id ?? ""}
            onChange={(event) => dialog.setConnectionPick(event.target.value)}
            className={fieldClass}
          >
            {dialog.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
                {connection.model ? ` — ${connection.model}` : ""}
                {isDefaultImageGenerationConnection(connection) ? " (Default)" : ""}
              </option>
            ))}
          </select>
        )}
      </section>

      <ReferencePictures dialog={dialog} />

      <section className="space-y-1.5">
        <label htmlFor={appearanceId} className={sectionLabel}>
          Appearance
        </label>
        <textarea
          id={appearanceId}
          rows={3}
          value={dialog.appearance}
          onChange={(event) => dialog.setAppearance(event.target.value)}
          placeholder="blue eyes, blonde hair, anime style, wearing a hoodie, female, chubby..."
          className={`${fieldClass} resize-y`}
        />
      </section>

      <section className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dialog.preferTransparent}
            onChange={(event) => dialog.setPreferTransparent(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          Prefer transparent PNG
        </label>
        <p className={hintText}>
          Adds transparent-output instructions when the selected model supports them, then applies cleanup before review
          when needed.
        </p>
        {dialog.showGptImage2Note && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            GPT-Image-2 does not support native transparent backgrounds right now, so cleanup is the fallback.
          </p>
        )}
      </section>

      {showMatchBox && (
        <section className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dialog.matchExisting}
              onChange={(event) => dialog.setMatchExisting(event.target.checked)}
              className="accent-[var(--primary)]"
            />
            Match existing expression sprites
          </label>
          <p className={hintText}>
            Generates idle full-body sprites named after the portrait expressions, saved as full_neutral, full_happy,
            and so on.
          </p>
        </section>
      )}

      {dialog.matchedMode ? <MatchedPanel dialog={dialog} /> : <PickPanel dialog={dialog} />}

      <div className="space-y-1.5 border-t border-[var(--border)]/40 pt-3">
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={dialog.generate}
            disabled={Boolean(dialog.missing)}
            title={dialog.generationUnavailable ? dialog.unavailableReason : undefined}
            aria-describedby={showMissing ? missingId : undefined}
            className={primaryButton}
          >
            {generateLabel(dialog)}
          </button>
        </div>
        {showMissing && (
          <p id={missingId} className={`${hintText} text-right`}>
            {dialog.missing}
          </p>
        )}
      </div>
    </div>
  );
}

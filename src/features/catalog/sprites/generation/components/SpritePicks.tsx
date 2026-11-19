import { useId } from "react";

import { planMatchedBatches } from "../lib/matched-batches";
import { chipLabel, chipNames, countLabel, spacedName, SPRITE_COUNTS } from "../lib/sprite-lists";
import { MAX_MATCHED_NAMES } from "../lib/sprite-names";
import type { SpriteGenerationController } from "../hooks/use-sprite-generation";
import { choiceButton, hintText, sectionLabel } from "./dialog-styles";

/** The count buttons and the expression or pose chips. */
export function PickPanel({ dialog }: { dialog: SpriteGenerationController }) {
  const countId = useId();
  const picksId = useId();
  const poses = dialog.spriteType === "full-body";
  const { cols, rows } = dialog.grid;
  const capacity = cols * rows;
  const hint =
    capacity === 1
      ? poses
        ? "Generate one full-body pose image. Pick the pose you want to render."
        : "Generate one portrait sprite. Pick the expression you want to render."
      : `Pick up to ${capacity}. A pick past ${capacity} replaces the oldest one.`;

  return (
    <>
      <section className="space-y-2">
        <h3 id={countId} className={sectionLabel}>
          {poses ? "Pose count" : "Expression count"}
        </h3>
        <div role="radiogroup" aria-labelledby={countId} className="flex flex-wrap gap-2">
          {SPRITE_COUNTS.map((option) => (
            <button
              key={option.count}
              type="button"
              role="radio"
              aria-checked={dialog.count === option.count}
              onClick={() => dialog.chooseCount(option.count)}
              className={choiceButton(dialog.count === option.count)}
            >
              {countLabel(option.count)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 id={picksId} className={sectionLabel}>
          {poses ? "Poses" : "Expressions"} ({dialog.picks.length} selected)
        </h3>
        <div role="group" aria-labelledby={picksId} className="flex flex-wrap gap-1.5">
          {chipNames(dialog.spriteType).map((name) => {
            const picked = dialog.picks.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={picked}
                onClick={() => dialog.togglePickName(name)}
                className={choiceButton(picked)}
              >
                {chipLabel(name)}
              </button>
            );
          })}
        </div>
        <p className={hintText}>{hint}</p>
      </section>
    </>
  );
}

/** Matched mode: the portrait names the full-body sprites will be named after. */
export function MatchedPanel({ dialog }: { dialog: SpriteGenerationController }) {
  const batches = planMatchedBatches(dialog.matchedNames).length;
  return (
    <section className="space-y-2 rounded-md border border-[var(--border)] p-3">
      <h3 className={sectionLabel}>Matched expressions ({dialog.matchedNames.length})</h3>
      <p className={hintText}>
        {batches} batch{batches === 1 ? "" : "es"} of up to 4
        {dialog.allMatchedNames.length > MAX_MATCHED_NAMES ? ` · First ${MAX_MATCHED_NAMES} used` : ""}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {dialog.matchedNames.map((name) => (
          <li key={name} className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs">
            {spacedName(name)}
          </li>
        ))}
      </ul>
      <p className={hintText}>
        Each batch of up to 4 is one sheet, for sharper sprites and cleaner cuts. Only the face and mood should change
        to match the expression name.
      </p>
    </section>
  );
}

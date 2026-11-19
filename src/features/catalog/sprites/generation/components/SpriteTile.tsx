import { Check, Crop, X } from "lucide-react";

import type { GeneratedSprite } from "../lib/generation-run";
import { spacedName } from "../lib/sprite-lists";
import { listFormName, normalizeSpriteName, spriteNameOptions } from "../lib/sprite-names";
import { fieldClass, smallButton } from "./dialog-styles";

/** One generated sprite on the review step: its picture, whether it is kept, and its name. */
export function SpriteTile({
  sprite,
  index,
  sharedOptions,
  duplicateWarning,
  framing,
  onToggle,
  onRename,
  onFrame,
}: {
  sprite: GeneratedSprite;
  index: number;
  sharedOptions: readonly string[];
  duplicateWarning: string | null;
  framing: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onFrame: () => void;
}) {
  const number = index + 1;
  const label = sprite.name ? spacedName(sprite.name) : `sprite ${number}`;
  const unnamed = sprite.name.trim() === "";
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-md border border-[var(--border)] p-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Picture of ${label}`}
        className="relative aspect-square w-full overflow-hidden rounded bg-[var(--secondary)]"
      >
        <img
          src={sprite.shown}
          alt=""
          className={`h-full w-full object-contain transition-opacity ${sprite.selected ? "" : "opacity-35"}`}
        />
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full ${
            sprite.selected ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-black/60 text-white"
          }`}
        >
          {sprite.selected ? <Check size="0.75rem" /> : <X size="0.75rem" />}
        </span>
      </button>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={sprite.selected} onChange={onToggle} className="accent-[var(--primary)]" />
        Keep {label}
      </label>
      <select
        aria-label={`Sprite ${number} name list`}
        value={listFormName(sprite.name)}
        onChange={(event) => onRename(normalizeSpriteName(event.target.value))}
        className={`${fieldClass} p-1 text-xs`}
      >
        {spriteNameOptions(sprite.name, sharedOptions).map((option) => (
          <option key={option || "(empty)"} value={option}>
            {spacedName(option)}
          </option>
        ))}
      </select>
      <input
        type="text"
        aria-label={`Sprite ${number} name`}
        value={sprite.name}
        onChange={(event) => onRename(normalizeSpriteName(event.target.value))}
        className={`${fieldClass} p-1 text-xs`}
      />
      {sprite.selected && unnamed && <p className="text-xs text-amber-600 dark:text-amber-400">Needs a name</p>}
      {duplicateWarning && <p className="text-xs text-amber-600 dark:text-amber-400">{duplicateWarning}</p>}
      <button
        type="button"
        onClick={onFrame}
        aria-pressed={framing}
        aria-label={`Frame sprite ${number}`}
        className={`${smallButton} ${framing ? "border-[var(--primary)] text-[var(--primary)]" : ""}`}
      >
        <Crop size="0.75rem" aria-hidden="true" />
        Frame
      </button>
    </li>
  );
}

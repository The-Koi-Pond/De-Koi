import type { RgbaPicture } from "./picture";

/** At most this many steps are kept on each list. */
export const HISTORY_LIMIT = 12;
/** Undo and redo together keep about this many bytes of pictures… */
export const HISTORY_BYTE_BUDGET = 256 * 1024 * 1024;
/** …but never fewer than this many undo steps. */
export const MIN_UNDO_STEPS = 3;

/** Pictures to go back to (oldest first) and forward to (the next redo last). */
export interface EditHistory {
  undo: RgbaPicture[];
  redo: RgbaPicture[];
}

export const EMPTY_HISTORY: EditHistory = { undo: [], redo: [] };

function bytes(history: EditHistory): number {
  let total = 0;
  for (const picture of history.undo) total += picture.data.byteLength;
  for (const picture of history.redo) total += picture.data.byteLength;
  return total;
}

/** Applies the step limits and the memory budget: drops the oldest undo steps first, then the furthest redo steps. */
function trim(history: EditHistory): EditHistory {
  const undo = history.undo.slice(-HISTORY_LIMIT);
  const redo = history.redo.slice(-HISTORY_LIMIT);
  const trimmed = { undo, redo };
  while (bytes(trimmed) > HISTORY_BYTE_BUDGET && undo.length > MIN_UNDO_STEPS) undo.shift();
  while (bytes(trimmed) > HISTORY_BYTE_BUDGET && redo.length > 1) redo.shift();
  return trimmed;
}

/** A change was made: the picture before it becomes the newest undo step and the redo list is cleared. */
export function recordChange(history: EditHistory, before: RgbaPicture): EditHistory {
  return trim({ undo: [...history.undo, before], redo: [] });
}

export interface HistoryMove {
  history: EditHistory;
  picture: RgbaPicture;
}

/** Steps back: the current picture goes onto the redo list. Null when there is nothing to undo. */
export function undoChange(history: EditHistory, current: RgbaPicture): HistoryMove | null {
  const picture = history.undo.at(-1);
  if (!picture) return null;
  return { picture, history: trim({ undo: history.undo.slice(0, -1), redo: [...history.redo, current] }) };
}

/** Steps forward: the current picture goes onto the undo list. Null when there is nothing to redo. */
export function redoChange(history: EditHistory, current: RgbaPicture): HistoryMove | null {
  const picture = history.redo.at(-1);
  if (!picture) return null;
  return { picture, history: trim({ undo: [...history.undo, current], redo: history.redo.slice(0, -1) }) };
}

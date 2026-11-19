import type { SpriteGrid } from "./sprite-lists";

export const MATCHED_BATCH_SIZE = 4;

export interface MatchedBatch {
  names: string[];
  grid: SpriteGrid;
}

/** A batch's sheet: 1 name is 1×1, 2 names are 2 columns × 1 row, 3 or 4 names are 2×2. */
export function matchedBatchGrid(nameCount: number): SpriteGrid {
  if (nameCount <= 1) return { cols: 1, rows: 1 };
  if (nameCount === 2) return { cols: 2, rows: 1 };
  return { cols: 2, rows: 2 };
}

/** The names split into batches of up to four, in order, each with its own sheet grid. */
export function planMatchedBatches(names: readonly string[]): MatchedBatch[] {
  const batches: MatchedBatch[] = [];
  for (let start = 0; start < names.length; start += MATCHED_BATCH_SIZE) {
    const batchNames = names.slice(start, start + MATCHED_BATCH_SIZE);
    batches.push({ names: batchNames, grid: matchedBatchGrid(batchNames.length) });
  }
  return batches;
}

/** The grid all matched sprites are reviewed in, by how many names there are. */
export function matchedOverallGrid(nameCount: number): SpriteGrid {
  if (nameCount <= 1) return { cols: 1, rows: 1 };
  if (nameCount === 2) return { cols: 2, rows: 1 };
  if (nameCount === 3) return { cols: 3, rows: 1 };
  if (nameCount === 4) return { cols: 2, rows: 2 };
  if (nameCount <= 6) return { cols: 3, rows: 2 };
  if (nameCount <= 9) return { cols: 3, rows: 3 };
  if (nameCount <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: 4 };
}

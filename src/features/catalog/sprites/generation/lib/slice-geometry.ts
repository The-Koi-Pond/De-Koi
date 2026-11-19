import type { SpriteGrid } from "./sprite-lists";

/** The cut panel's sliders, all percentages. Cuts nudge the inner lines, one per inner line of the grid. */
export interface SliceSettings {
  sideMargin: number;
  topBottomMargin: number;
  columnGap: number;
  rowGap: number;
  nudgeX: number;
  nudgeY: number;
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
  rowCuts: number[];
  columnCuts: number[];
}

/** Every slider at zero, with one column cut per inner column line and one row cut per inner row line. */
export function zeroSliceSettings(grid: SpriteGrid | null): SliceSettings {
  return {
    sideMargin: 0,
    topBottomMargin: 0,
    columnGap: 0,
    rowGap: 0,
    nudgeX: 0,
    nudgeY: 0,
    cropTop: 0,
    cropBottom: 0,
    cropLeft: 0,
    cropRight: 0,
    rowCuts: grid ? new Array<number>(Math.max(0, grid.rows - 1)).fill(0) : [],
    columnCuts: grid ? new Array<number>(Math.max(0, grid.cols - 1)).fill(0) : [],
  };
}

/** A box on a sheet, in whole pixels: left/top inclusive, right/bottom exclusive. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One of the dialog's own checks, worded for the person using it. */
export class SliceAreaError extends Error {
  constructor() {
    super("These cut settings leave no room for a sprite. Lower the margins, gaps or crops.");
    this.name = "SliceAreaError";
  }
}

function percentOf(size: number, percent: number): number {
  return Math.round((size * percent) / 100);
}

/**
 * The cut lines along one axis of a sheet: the two outer lines plus one per inner line, kept at least
 * max(8, 3% of the size) apart.
 */
export function sliceLines(
  size: number,
  cells: number,
  margin: number,
  nudge: number,
  cuts: readonly number[],
): number[] {
  const marginPx = percentOf(size, margin);
  const nudgePx = percentOf(size, nudge);
  const start = marginPx + nudgePx;
  const end = size - marginPx + nudgePx;
  const lines = [start];
  for (let k = 1; k < cells; k += 1) {
    lines.push(start + (k / cells) * (end - start) + percentOf(size, cuts[k - 1] ?? 0));
  }
  lines.push(end);

  // The outer lines stay put: inner lines move forward away from the line before them, then back away from the line
  // after them.
  const minSpacing = Math.max(8, Math.floor(size * 0.03));
  const last = lines.length - 1;
  for (let index = 1; index < last; index += 1) {
    if (lines[index] - lines[index - 1] < minSpacing) lines[index] = lines[index - 1] + minSpacing;
  }
  for (let index = last - 1; index >= 1; index -= 1) {
    if (lines[index + 1] - lines[index] < minSpacing) lines[index] = lines[index + 1] - minSpacing;
  }
  return lines;
}

function cellSpan(lines: readonly number[], index: number, size: number, gap: number): [number, number] {
  const halfGap = percentOf(size, gap) / 2;
  const start = lines[index] + (index > 0 ? halfGap : 0);
  const end = lines[index + 1] - (index < lines.length - 2 ? halfGap : 0);
  return [Math.ceil(start), Math.floor(end)];
}

export interface SheetCell {
  sheetWidth: number;
  sheetHeight: number;
  grid: SpriteGrid;
  /** Where the sprite sits on its sheet, counted left to right, top to bottom. */
  position: number;
}

/** The box of the sheet a sprite is re-cut from. Throws {@link SliceAreaError} when the settings leave nothing. */
export function spriteSliceBox(cell: SheetCell, settings: SliceSettings): PixelBox {
  const { sheetWidth, sheetHeight, grid } = cell;
  const column = cell.position % grid.cols;
  const row = Math.floor(cell.position / grid.cols);
  const columnLines = sliceLines(sheetWidth, grid.cols, settings.sideMargin, settings.nudgeX, settings.columnCuts);
  const rowLines = sliceLines(sheetHeight, grid.rows, settings.topBottomMargin, settings.nudgeY, settings.rowCuts);
  const [boxLeft, boxRight] = cellSpan(columnLines, column, sheetWidth, settings.columnGap);
  const [boxTop, boxBottom] = cellSpan(rowLines, row, sheetHeight, settings.rowGap);
  const boxWidth = boxRight - boxLeft;
  const boxHeight = boxBottom - boxTop;
  if (boxWidth <= 0 || boxHeight <= 0) throw new SliceAreaError();

  const left = Math.max(0, boxLeft + percentOf(boxWidth, settings.cropLeft));
  const right = Math.min(sheetWidth, boxRight - percentOf(boxWidth, settings.cropRight));
  const top = Math.max(0, boxTop + percentOf(boxHeight, settings.cropTop));
  const bottom = Math.min(sheetHeight, boxBottom - percentOf(boxHeight, settings.cropBottom));
  if (right - left <= 0 || bottom - top <= 0) throw new SliceAreaError();
  return { left, top, width: right - left, height: bottom - top };
}

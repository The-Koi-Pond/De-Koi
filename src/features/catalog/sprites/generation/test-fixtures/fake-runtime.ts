import { ApiError } from "../../../../../shared/api/api-errors";
import type { SpriteFrameAdjustments } from "../../../../../shared/lib/sprite-frame-crop";
import type { LoadedSheet } from "../lib/sheet-raster";
import type { PixelBox } from "../lib/slice-geometry";

/** A sprite_* call as the recording keeps it. */
export interface RecordedCall {
  command: string;
  args: unknown;
  reply?: unknown;
  replyError?: { code: string; message: string };
}

/** Every command the dialog sent, and the replies still to hand out, in order. */
export const runtime = {
  sent: [] as Array<{ command: string; args: unknown }>,
  replies: [] as RecordedCall[],
  reset(replies: RecordedCall[] = []) {
    this.sent = [];
    this.replies = [...replies];
  },
};

/** The fake cleanup answered every cell with the same transparent picture. */
const CLEANED_REPLY = "cleaned(fake:clean per cell)";

function replyFor(recorded: RecordedCall, args: unknown): unknown {
  if (recorded.reply === CLEANED_REPLY) {
    const cells = ((args as { body?: { cells?: Array<{ expression: string }> } }).body?.cells ?? []).map((cell) => ({
      expression: cell.expression,
      base64: "fake:clean",
    }));
    return {
      cells,
      engine: "auto",
      externalCleanupProcessed: 0,
      backgroundRemoverProcessed: 0,
      builtinProcessed: cells.length,
    };
  }
  return recorded.reply ?? {};
}

/** Stands in for `invokeTauri`: records the call and answers with the recorded reply in the same position. */
export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  runtime.sent.push({ command, args: JSON.parse(JSON.stringify(args ?? null)) });
  const recorded = runtime.replies.shift();
  if (!recorded) throw new Error(`No recorded reply left for ${command}`);
  if (recorded.replyError) {
    throw new ApiError(recorded.replyError.message, 500, recorded.replyError);
  }
  return replyFor(recorded, args) as T;
}

/** Sheet sizes like Rust's: 512 px wide cells, 512 px high for portraits and 768 for full-body. */
export async function loadSheet(dataUrl: string): Promise<LoadedSheet> {
  const label = dataUrl.replace(/^data:image\/png;base64,/, "");
  const match = /^fake:(\d+)x(\d+)(-full)?:sheet$/.exec(label);
  if (!match) throw new Error(`Sheet ${label} could not be loaded`);
  const cellHeight = match[3] ? 768 : 512;
  return {
    image: { label } as unknown as CanvasImageSource,
    width: Number(match[1]) * 512,
    height: Number(match[2]) * cellHeight,
  };
}

/** A re-cut picture, labelled with the sheet and box it came from. */
export function cutSheetBox(sheet: LoadedSheet, box: PixelBox): string {
  const { label } = sheet.image as unknown as { label: string };
  return `data:image/png;base64,cut:${label}@${box.left},${box.top},${box.width}x${box.height}`;
}

/** A framed picture, labelled with the frame and the picture it came from. */
export async function cropSpriteDataUrl(dataUrl: string, frame: SpriteFrameAdjustments): Promise<string> {
  const label = dataUrl.replace(/^data:image\/png;base64,/, "");
  return `data:image/png;base64,frame:${frame.top},${frame.bottom},${frame.left},${frame.right}:${label}`;
}

/** Pictures the dialog made itself (re-cut or framed); the recording labels them `other:<hash>:<length>`. */
export function isDialogMadePicture(value: string): boolean {
  return /^data:image\/png;base64,(cut:|frame:|other:)/.test(value);
}

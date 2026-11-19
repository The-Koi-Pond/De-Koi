import type {
  ImagePromptOverride,
  ImagePromptReviewItem,
} from "../../../../../shared/components/ui/ImagePromptReviewModal";
import type { MatchedBatch } from "./matched-batches";
import {
  buildCleanupBody,
  buildGenerationBody,
  pngDataUrl,
  withPromptOverrides,
  type SpriteCleanupBody,
  type SpriteGenerationBody,
  type SpriteGenerationInput,
} from "./request-bodies";
import {
  CLEANUP_AFTER_GENERATION_FAILED,
  GENERATION_FAILED,
  SpriteCheckError,
  spriteErrorMessage,
} from "./sprite-errors";
import { spacedName, type SpriteGrid } from "./sprite-lists";

/** One generated sprite under review. */
export interface GeneratedSprite {
  id: string;
  /** The name as held; the save name is worked out from it at Save time. */
  name: string;
  /** What generation, cuts and frames produce. Cleanup always starts from it. */
  original: string;
  /** What the tile shows and Save sends: the original or its cleaned copy. */
  shown: string;
  selected: boolean;
  /** The sheet it was cut from, when the reply had one. */
  sheetIndex: number | null;
  /** Where it sits on that sheet, counted left to right, top to bottom. */
  position: number;
}

export interface GeneratedSheet {
  label: string;
  src: string;
  grid: SpriteGrid;
}

export interface SheetReply {
  sheetBase64?: string;
  cells?: Array<{ expression: string; base64: string }>;
  failedExpressions?: Array<{ expression: string; error: string }>;
}

interface CleanupReply {
  cells?: Array<{ expression?: string; base64?: string | null }>;
}

/** The commands and the prompt review a run uses. */
export interface GenerationPorts {
  /** "Expose image prompts before sending", read when the run starts. */
  reviewPrompts: boolean;
  preview: (body: SpriteGenerationBody) => Promise<{ items?: ImagePromptReviewItem[] }>;
  generate: (body: SpriteGenerationBody) => Promise<SheetReply>;
  /** Opens the prompt review; null when it was cancelled. */
  review: (items: ImagePromptReviewItem[]) => Promise<ImagePromptOverride[] | null>;
  cleanup: (body: SpriteCleanupBody) => Promise<CleanupReply>;
  nextId: () => string;
}

/**
 * One generation request: with the prompt review on, a preview first and, when it has items, the review. Returns
 * null when the review was cancelled; nothing more is sent then.
 */
export async function requestSheet(body: SpriteGenerationBody, ports: GenerationPorts): Promise<SheetReply | null> {
  if (ports.reviewPrompts) {
    const preview = await ports.preview(body);
    const items = preview.items ?? [];
    if (items.length > 0) {
      const overrides = await ports.review(items);
      if (!overrides) return null;
      return ports.generate(withPromptOverrides(body, overrides));
    }
  }
  return ports.generate(body);
}

/** A reply's sheet, when it has one (an empty `sheetBase64` means it hasn't). */
export function sheetFromReply(reply: SheetReply, label: string, grid: SpriteGrid): GeneratedSheet | null {
  return reply.sheetBase64 ? { label, src: pngDataUrl(reply.sheetBase64), grid } : null;
}

/** One selected sprite per reply cell, in order, named by the cell's expression. */
export function spritesFromReply(
  reply: SheetReply,
  sheetIndex: number | null,
  nextId: () => string,
): GeneratedSprite[] {
  return (reply.cells ?? []).map((cell, position) => {
    const picture = pngDataUrl(cell.base64);
    return {
      id: nextId(),
      name: cell.expression,
      original: picture,
      shown: picture,
      selected: true,
      sheetIndex,
      position,
    };
  });
}

/** Cleans every given sprite from its original picture; the reply's cells match by position. */
export async function cleanSprites(
  sprites: readonly GeneratedSprite[],
  strength: number,
  cleanup: GenerationPorts["cleanup"],
): Promise<GeneratedSprite[]> {
  const reply = await cleanup(
    buildCleanupBody(
      strength,
      sprites.map((sprite) => ({ expression: sprite.name, base64: sprite.original })),
    ),
  );
  const cells = reply.cells ?? [];
  return sprites.map((sprite, index) => {
    const cleaned = cells[index]?.base64;
    return cleaned ? { ...sprite, shown: pngDataUrl(cleaned) } : sprite;
  });
}

interface MatchedRunState {
  sprites: GeneratedSprite[];
  sheets: GeneratedSheet[];
}

export interface MatchedRunOptions {
  batches: readonly MatchedBatch[];
  /** The first batch to run; earlier ones are already collected. */
  startIndex: number;
  /** Everything but the batch's names and grid, fixed when Generate was pressed. */
  template: Omit<SpriteGenerationInput, "expressions" | "grid">;
  collected: MatchedRunState;
  ports: GenerationPorts;
  /** "Transparent background" and the cleanup strength, read as each batch finishes. */
  cleanupSettings: () => { enabled: boolean; strength: number };
  onProgress: (line: string) => void;
  /** False once the run was replaced (a new owner, a new run, Back to setup); nothing more is sent then. */
  isCurrent: () => boolean;
}

export interface MatchedRunResult extends MatchedRunState {
  /** The batch that failed both tries, with what to show; null when every batch went through. */
  failure: { batchIndex: number; message: string } | null;
  /** The batch whose prompt review was cancelled; the run stopped there and that batch waits for Retry batch. */
  cancelledAt: number | null;
  /** The run was replaced and stopped early; its results must not be shown. */
  stale: boolean;
  cleaned: boolean;
  /** A note to show with the results, e.g. that the background couldn't be removed from some batches. */
  note: string | null;
}

export function batchProgressLine(index: number, total: number, names: readonly string[], retrying: boolean): string {
  return `Batch ${index + 1} of ${total}${retrying ? " (retrying once)" : ""}: ${names.map(spacedName).join(", ")}`;
}

async function runBatchTry(
  batch: MatchedBatch,
  batchIndex: number,
  options: MatchedRunOptions,
  sheetIndex: number,
): Promise<{
  sprites: GeneratedSprite[];
  sheet: GeneratedSheet | null;
  cleaned: boolean;
  cleanupFailed: boolean;
} | null> {
  const body = buildGenerationBody({ ...options.template, expressions: batch.names, grid: batch.grid });
  const reply = await requestSheet(body, options.ports);
  if (!reply) return null;
  if (reply.failedExpressions && reply.failedExpressions.length > 0) {
    throw new SpriteCheckError(
      reply.failedExpressions.map((failed) => `${failed.expression}: ${failed.error}`).join("; "),
    );
  }
  if ((reply.cells ?? []).length < batch.names.length) {
    throw new SpriteCheckError("The provider returned fewer sprites than requested");
  }
  const sheet = sheetFromReply(reply, `Batch ${batchIndex + 1}`, batch.grid);
  let sprites = spritesFromReply(reply, sheet ? sheetIndex : null, options.ports.nextId);
  const cleanup = options.cleanupSettings();
  if (!cleanup.enabled) return { sprites, sheet, cleaned: false, cleanupFailed: false };
  try {
    sprites = await cleanSprites(sprites, cleanup.strength, options.ports.cleanup);
    return { sprites, sheet, cleaned: true, cleanupFailed: false };
  } catch {
    // The paid pictures stay uncleaned; generating the batch again would be a second paid request.
    return { sprites, sheet, cleaned: false, cleanupFailed: true };
  }
}

/**
 * Runs matched batches one after another, from `startIndex`. Each batch gets two tries; a batch that fails both stops
 * the run, and what was collected so far is kept. A cancelled prompt review stops the run at once (no second try),
 * and a run that is no longer current sends nothing more.
 */
export async function runMatchedBatches(options: MatchedRunOptions): Promise<MatchedRunResult> {
  const sprites = [...options.collected.sprites];
  const sheets = [...options.collected.sheets];
  let cleaned = false;
  let cleanupFailed = false;
  const total = options.batches.length;
  const finish = (rest: Pick<MatchedRunResult, "failure" | "cancelledAt" | "stale">): MatchedRunResult => ({
    sprites,
    sheets,
    cleaned,
    note: cleanupFailed ? CLEANUP_AFTER_GENERATION_FAILED : null,
    ...rest,
  });
  for (let batchIndex = options.startIndex; batchIndex < total; batchIndex += 1) {
    const batch = options.batches[batchIndex];
    let lastError: unknown = null;
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt += 1) {
      if (!options.isCurrent()) return finish({ failure: null, cancelledAt: null, stale: true });
      options.onProgress(batchProgressLine(batchIndex, total, batch.names, attempt > 0));
      try {
        const result = await runBatchTry(batch, batchIndex, options, sheets.length);
        if (!result) return finish({ failure: null, cancelledAt: batchIndex, stale: !options.isCurrent() });
        if (result.sheet) sheets.push(result.sheet);
        sprites.push(...result.sprites);
        cleaned = cleaned || result.cleaned;
        cleanupFailed = cleanupFailed || result.cleanupFailed;
        done = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!done) {
      const reason = spriteErrorMessage(lastError, GENERATION_FAILED);
      return finish({
        failure: {
          batchIndex,
          message: `Batch ${batchIndex + 1} of ${total} failed after one automatic retry: ${reason}`,
        },
        cancelledAt: null,
        stale: !options.isCurrent(),
      });
    }
  }
  return finish({ failure: null, cancelledAt: null, stale: !options.isCurrent() });
}

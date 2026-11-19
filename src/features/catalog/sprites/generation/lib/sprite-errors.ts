import { getErrorMessage } from "../../../../../shared/lib/error-message";
import { SliceAreaError } from "./slice-geometry";

export const GENERATION_FAILED = "Image generation failed. Try again.";
export const CLEANUP_FAILED = "Couldn't apply background cleanup. Try again.";
export const CLEANUP_AFTER_GENERATION_FAILED = "Couldn't remove the background. Use Apply cleanup to try again.";
export const SLICE_FAILED = "Couldn't adjust sprite slices. Try again.";
export const FRAME_FAILED = "Couldn't frame sprite. Try again.";
export const SAVE_FAILED = "Couldn't save sprites. Try again.";

/** One of the dialog's own checks on a reply. Its message is already written for the person using the dialog. */
export class SpriteCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpriteCheckError";
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const own = (error as { code?: unknown }).code;
  if (typeof own === "string") return own;
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === "object") {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/**
 * What a failure says. The dialog's own checks and Rust's two sprite generation codes have their own words; anything
 * else goes through `getErrorMessage` with the fallback.
 */
export function spriteErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SpriteCheckError || error instanceof SliceAreaError) return error.message;
  const code = errorCode(error);
  if (code === "sprite_generation_timeout") {
    const seconds = error instanceof Error ? /(\d+)\s*seconds?/.exec(error.message)?.[1] : undefined;
    return seconds
      ? `Sprite generation took longer than ${seconds} seconds. Try again, or pick a smaller grid.`
      : "Sprite generation took too long. Try again, or pick a smaller grid.";
  }
  if (code === "sprite_generation_failed") {
    return "None of the sprites could be generated. Try again, or pick another connection.";
  }
  return getErrorMessage(error, fallback);
}

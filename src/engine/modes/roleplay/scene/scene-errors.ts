import { isRecord, readString } from "../../../generation/runtime-records";

function errorCode(error: unknown): string {
  if (!isRecord(error) && !(error instanceof Error)) return "";
  const record = error as { code?: unknown; details?: unknown };
  const code = readString(record.code).trim();
  if (code) return code;
  return isRecord(record.details) ? readString(record.details.code).trim() : "";
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "unknown error";
}

/**
 * Prefixes a failure with what the scene was doing, keeping the original error's code (a provider's worded error, or
 * a `user_facing` one) so the app still shows its message.
 */
export function sceneStepError(step: string, error: unknown): Error {
  const wrapped = new Error(`${step}: ${reasonOf(error)}`, { cause: error });
  const code = errorCode(error);
  return code ? Object.assign(wrapped, { code }) : wrapped;
}

/**
 * Undoes a half-finished write after `error`, then throws `error`. When the undo fails too, the thrown error names
 * both failures.
 */
export async function undoThenThrow(error: unknown, undo: () => Promise<void>): Promise<never> {
  try {
    await undo();
  } catch (undoError) {
    throw new Error(`${reasonOf(error)} Undoing the unfinished change also failed: ${reasonOf(undoError)}`, {
      cause: error,
    });
  }
  throw error;
}

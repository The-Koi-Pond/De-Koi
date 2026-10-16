export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get payload() {
    return this.details;
  }
}

/**
 * Storage rejected creating `entity/id` because that exact row already exists.
 * Matches the storage owner's message for that record only, so validation and
 * other 400 errors still propagate. Checked by shape, not class identity, so it
 * also matches an ApiError thrown by a separately loaded copy of this module.
 */
export function isDuplicateCreateError(error: unknown, entity: string, id: string): boolean {
  return (
    error instanceof Error &&
    error.name === "ApiError" &&
    (error as ApiError).status === 400 &&
    error.message.trim() === `${entity}/${id} already exists`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseRetryAfterMs(value: string | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

export function getApiErrorRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof ApiError) || !isRecord(error.details)) return null;
  const retryAfterMs = error.details.retryAfterMs;
  return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : null;
}

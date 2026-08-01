const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404]);

function explicitHttpStatus(error: unknown): number | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  const messageStatus = /\bHTTP\s+(\d{3})\b/i.exec(message)?.[1];
  if (messageStatus) return Number(messageStatus);
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function isTerminalBackgroundGenerationError(error: unknown): boolean {
  const status = explicitHttpStatus(error);
  return status !== null && TERMINAL_HTTP_STATUSES.has(status);
}

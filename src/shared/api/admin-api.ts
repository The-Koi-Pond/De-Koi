import { invokeTauri } from "./tauri-client";
import { ApiError } from "./api-errors";

export type ExpungeCause = {
  code: string;
  message: string;
  details?: unknown;
};

export type ExpungeSuccessReceipt = {
  success: true;
  requestedScopes: string[];
  completedScopes: string[];
  remainingScopes: string[];
  clearedCollections: string[];
};

export type ExpungeFailureReceipt = {
  success: false;
  requestedScopes: string[];
  completedScopes: string[];
  remainingScopes: string[];
  failedScope: string | null;
  clearedCollections: string[];
  cause: ExpungeCause;
};

export class ExpungeError extends ApiError {
  constructor(
    message: string,
    status: number,
    public readonly receipt: ExpungeFailureReceipt,
    details?: unknown,
  ) {
    super(message, status, details);
    this.name = "ExpungeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value as string[];
}

function normalizeExpungeSuccess(value: unknown, requestedScopes: readonly string[]): ExpungeSuccessReceipt {
  if (!isRecord(value) || value.success !== true) {
    throw new Error("Invalid data erasure response");
  }

  const clearedCollections = Object.hasOwn(value, "clearedCollections")
    ? readStringArray(value.clearedCollections)
    : [];
  if (!clearedCollections) throw new Error("Invalid data erasure response");

  const hasModernReceiptFields = ["requestedScopes", "completedScopes", "remainingScopes"].some((field) =>
    Object.hasOwn(value, field),
  );
  if (!hasModernReceiptFields) {
    return {
      success: true,
      requestedScopes: [...requestedScopes],
      completedScopes: [...requestedScopes],
      remainingScopes: [],
      clearedCollections,
    };
  }

  const receiptRequestedScopes = readStringArray(value.requestedScopes);
  const completedScopes = readStringArray(value.completedScopes);
  const remainingScopes = readStringArray(value.remainingScopes);
  if (!receiptRequestedScopes || !completedScopes || !remainingScopes || !Object.hasOwn(value, "clearedCollections")) {
    throw new Error("Invalid data erasure response");
  }

  return {
    success: true,
    requestedScopes: receiptRequestedScopes,
    completedScopes,
    remainingScopes,
    clearedCollections,
  };
}

function readExpungeCause(value: unknown): ExpungeCause | null {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") return null;
  return {
    code: value.code,
    message: value.message,
    ...(Object.hasOwn(value, "details") ? { details: value.details } : {}),
  };
}

function readExpungeFailureReceipt(value: unknown): ExpungeFailureReceipt | null {
  if (!isRecord(value) || value.success !== false) return null;
  const requestedScopes = readStringArray(value.requestedScopes);
  const completedScopes = readStringArray(value.completedScopes);
  const remainingScopes = readStringArray(value.remainingScopes);
  const clearedCollections = readStringArray(value.clearedCollections);
  const cause = readExpungeCause(value.cause);
  const failedScope = typeof value.failedScope === "string" ? value.failedScope : null;
  if (!requestedScopes || !completedScopes || !remainingScopes || !clearedCollections || !cause) return null;
  return {
    success: false,
    requestedScopes,
    completedScopes,
    remainingScopes,
    failedScope,
    clearedCollections,
    cause,
  };
}

export function getExpungeFailureReceipt(error: unknown): ExpungeFailureReceipt | null {
  if (error instanceof ExpungeError) return error.receipt;
  if (!(error instanceof ApiError)) return null;
  const direct = readExpungeFailureReceipt(error.details);
  if (direct) return direct;
  return isRecord(error.details) ? readExpungeFailureReceipt(error.details.details) : null;
}

function normalizeExpungeError(error: unknown, requestedScopes: readonly string[]): ExpungeError {
  if (error instanceof ExpungeError) return error;
  const structuredReceipt = getExpungeFailureReceipt(error);
  if (structuredReceipt) {
    const apiError = error as ApiError;
    return new ExpungeError(apiError.message, apiError.status, structuredReceipt, apiError.details);
  }

  const apiError = error instanceof ApiError ? error : null;
  const details = apiError?.details;
  const detailRecord = isRecord(details) ? details : null;
  const message = apiError?.message ?? (error instanceof Error ? error.message : "Could not finish erasing data");
  const cause: ExpungeCause = {
    code: typeof detailRecord?.code === "string" ? detailRecord.code : "expunge_failed",
    message,
    ...(details === undefined ? {} : { details }),
  };
  return new ExpungeError(
    message,
    apiError?.status ?? 500,
    {
      success: false,
      requestedScopes: [...requestedScopes],
      completedScopes: [],
      remainingScopes: [...requestedScopes],
      failedScope: null,
      clearedCollections: [],
      cause,
    },
    details,
  );
}

export const adminApi = {
  expunge: async (scopes: readonly string[]) => {
    try {
      return normalizeExpungeSuccess(await invokeTauri<unknown>("admin_expunge_command", { scopes }), scopes);
    } catch (error) {
      throw normalizeExpungeError(error, scopes);
    }
  },
  clearAll: () => invokeTauri<{ success: boolean }>("admin_clear_all_command", { confirm: true }),
};

const LOCAL_STORAGE_KEY = "deKoiPerformanceDiagnostics";
const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OMIT_DETAIL_KEYS = new Set(["arg", "args", "body", "payload", "request", "value", "values"]);
const emittedMilestones = new Set<string>();

export type PerformanceDiagnosticsSpan = {
  category: string;
  name: string;
  details?: Record<string, unknown>;
};

function enabledValue(value: unknown): boolean {
  return typeof value === "string" && ENABLED_VALUES.has(value.trim().toLowerCase());
}

function envFlagEnabled(): boolean {
  return enabledValue(import.meta.env.VITE_DE_KOI_PERFORMANCE_DIAGNOSTICS);
}

function storageFlagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return enabledValue(window.localStorage.getItem(LOCAL_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return envFlagEnabled() || storageFlagEnabled();
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.round((nowMs() - startedAt) * 100) / 100;
}

function diagnosticDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  return Object.fromEntries(Object.entries(details).filter(([key]) => !OMIT_DETAIL_KEYS.has(key.toLowerCase())));
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return { errorMessage: String(error ?? "Unknown error") };
}

export function markPerformanceMilestone(name: string, details?: Record<string, unknown>): void {
  if (!isPerformanceDiagnosticsEnabled()) return;
  try {
    performance.mark(`de-koi:${name}`);
  } catch {
    // Browser performance markers are optional; diagnostics logging still helps.
  }
  console.info("[de-koi:perf] mark", {
    name,
    ...diagnosticDetails(details),
  });
}

export function markPerformanceMilestoneOnce(name: string, details?: Record<string, unknown>): void {
  if (emittedMilestones.has(name)) return;
  emittedMilestones.add(name);
  markPerformanceMilestone(name, details);
}

export async function measurePerformanceAsync<T>(
  span: PerformanceDiagnosticsSpan,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isPerformanceDiagnosticsEnabled()) return operation();

  const startedAt = nowMs();
  try {
    const result = await operation();
    console.info("[de-koi:perf] span", {
      category: span.category,
      name: span.name,
      status: "ok",
      elapsedMs: elapsedMs(startedAt),
      ...diagnosticDetails(span.details),
    });
    return result;
  } catch (error) {
    console.warn("[de-koi:perf] span", {
      category: span.category,
      name: span.name,
      status: "error",
      elapsedMs: elapsedMs(startedAt),
      ...diagnosticDetails(span.details),
      ...errorDetails(error),
    });
    throw error;
  }
}

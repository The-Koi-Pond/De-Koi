import type { ClientDiagnosticRecord } from "../../../../shared/lib/client-diagnostics";
import type { SupportPlatformInfo } from "../../../../shared/lib/support-report";

export type DiagnosticStatus = "ok" | "warning" | "degraded" | "error" | "unknown";
export type DiagnosticsRuntimeMode = "embedded" | "remote" | "web-shell";

export interface DiagnosticItem {
  id: string;
  label: string;
  status: DiagnosticStatus;
  summary: string;
  details?: unknown;
}

export interface DiagnosticsSection {
  id: string;
  title: string;
  status: DiagnosticStatus;
  items: DiagnosticItem[];
}

export interface DiagnosticsLogTail {
  available: boolean;
  path: string | null;
  lines: string[];
  truncated: boolean;
  error?: string;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  appVersion: string;
  platform: SupportPlatformInfo;
  logTail: DiagnosticsLogTail | null;
  runtimeMode: DiagnosticsRuntimeMode;
  overallStatus: DiagnosticStatus;
  sections: DiagnosticsSection[];
  recentDiagnostics: ClientDiagnosticRecord[];
}

export interface TroubleshootingPacket {
  schema: "de-koi-diagnostics.v1";
  generatedAt: string;
  appVersion: string;
  platform: SupportPlatformInfo;
  logTail: DiagnosticsLogTail | null;
  runtimeMode: DiagnosticsRuntimeMode;
  overallStatus: DiagnosticStatus;
  sections: DiagnosticsSection[];
  recentDiagnostics: ClientDiagnosticRecord[];
}
function section(id: string, title: string, items: DiagnosticItem[]): DiagnosticsSection {
  return {
    id,
    title,
    status: diagnosticsOverallStatus(items),
    items,
  };
}

const SECRET_REPLACEMENT = "[redacted]";
const LOCAL_PATH_REPLACEMENT = "[redacted local path]";
const DATA_URI_REPLACEMENT = "[redacted data uri]";
const ENCODED_REPLACEMENT = "[redacted encoded data]";
const STACK_LINE_LIMIT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "apikey" ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "password" ||
    normalized === "passwd" ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "adminsecret" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
}

function sensitiveUrlParam(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "key" ||
    normalized === "apikey" ||
    normalized === "token" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized.endsWith("key") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret")
  );
}

function redactUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveUrlParam(key)) {
        url.searchParams.set(key, SECRET_REPLACEMENT);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function looksLikeEncodedBlob(value: string): boolean {
  const compact = value.trim();
  return compact.length >= 64 && /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function redactLocalPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, LOCAL_PATH_REPLACEMENT)
    .replace(/\/(?:Users|home|var|tmp)\/[^\s"'<>|]+/g, LOCAL_PATH_REPLACEMENT);
}

function redactStack(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= STACK_LINE_LIMIT) return value;
  return [...lines.slice(0, STACK_LINE_LIMIT), "[stack truncated]"].join("\n");
}

function redactInlineSecrets(value: string): string {
  return value.replace(/\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, (_match, key: string) => `${key}=${SECRET_REPLACEMENT}`);
}

function redactString(value: string, key?: string): string {
  if (/^data:[^,]+,/i.test(value)) return DATA_URI_REPLACEMENT;
  const url = redactUrl(value);
  if (url) return url;
  if (looksLikeEncodedBlob(value)) return ENCODED_REPLACEMENT;

  let next = redactInlineSecrets(redactLocalPaths(value));
  if (key?.toLowerCase() === "stack") {
    next = redactStack(next);
  }
  return next;
}

function redactInternal(value: unknown, key: string | undefined, seen: WeakSet<object>, depth: number): unknown {
  if (key && sensitiveKey(key)) return SECRET_REPLACEMENT;
  if (typeof value === "string") return redactString(value, key);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[circular]";
  if (depth > 8) return "[max depth reached]";

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, undefined, seen, depth + 1));
  }
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    next[entryKey] = redactInternal(entryValue, entryKey, seen, depth + 1);
  }
  return next;
}

export function redactDiagnosticsValue(value: unknown): unknown {
  return redactInternal(value, undefined, new WeakSet<object>(), 0);
}

function statusRank(status: DiagnosticStatus): number {
  switch (status) {
    case "error":
      return 4;
    case "warning":
    case "degraded":
      return 3;
    case "unknown":
      return 0;
    case "ok":
      return 1;
  }
}

export function diagnosticsOverallStatus(items: readonly { status: DiagnosticStatus }[]): DiagnosticStatus {
  if (items.length === 0) return "unknown";
  if (items.every((item) => item.status === "unknown")) return "unknown";
  const highest = items.reduce<DiagnosticStatus>(
    (current, item) => (statusRank(item.status) > statusRank(current) ? item.status : current),
    "ok",
  );
  return highest === "degraded" ? "warning" : highest;
}
type GenerationTimingDiagnostic = {
  name: string;
  durationMs: number;
  chatId: string;
  chatMode: string;
  groupChatMode: string | null;
  characterCount: number;
  targetCharacterId: string | null;
  messageCount?: number;
  promptMessageCount?: number;
  savedUserMessage?: boolean;
  timestamp: string;
};

function generationTimingDiagnostic(entry: ClientDiagnosticRecord): GenerationTimingDiagnostic | null {
  if (entry.source !== "generation-timing") return null;
  const details = isRecord(entry.details) ? entry.details : {};
  if (details.kind !== "timing") return null;
  const name = typeof details.name === "string" ? details.name.trim() : "";
  const durationMs = typeof details.durationMs === "number" && Number.isFinite(details.durationMs) ? details.durationMs : NaN;
  if (!name || !Number.isFinite(durationMs)) return null;
  const groupChatMode = typeof details.groupChatMode === "string" && details.groupChatMode.trim()
    ? details.groupChatMode.trim()
    : null;
  const targetCharacterId = typeof details.targetCharacterId === "string" && details.targetCharacterId.trim()
    ? details.targetCharacterId.trim()
    : null;
  const timing: GenerationTimingDiagnostic = {
    name,
    durationMs,
    chatId: typeof details.chatId === "string" ? details.chatId : "",
    chatMode: typeof details.chatMode === "string" && details.chatMode.trim() ? details.chatMode.trim() : "unknown",
    groupChatMode,
    characterCount:
      typeof details.characterCount === "number" && Number.isFinite(details.characterCount)
        ? Math.max(0, Math.round(details.characterCount))
        : 0,
    targetCharacterId,
    timestamp: entry.timestamp,
  };
  if (typeof details.messageCount === "number" && Number.isFinite(details.messageCount)) {
    timing.messageCount = Math.max(0, Math.round(details.messageCount));
  }
  if (typeof details.promptMessageCount === "number" && Number.isFinite(details.promptMessageCount)) {
    timing.promptMessageCount = Math.max(0, Math.round(details.promptMessageCount));
  }
  if (typeof details.savedUserMessage === "boolean") timing.savedUserMessage = details.savedUserMessage;
  return timing;
}

function formatTimingDuration(durationMs: number): string {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${Math.round(durationMs)}ms`;
}

function generationTimingStatus(durationMs: number): DiagnosticStatus {
  if (durationMs >= 30_000) return "error";
  if (durationMs >= 10_000) return "warning";
  return "ok";
}

export function buildGenerationTimingSection(recentDiagnostics: readonly ClientDiagnosticRecord[]): DiagnosticsSection {
  const timings = recentDiagnostics
    .map(generationTimingDiagnostic)
    .filter((timing): timing is GenerationTimingDiagnostic => timing !== null);

  if (timings.length === 0) {
    return section("generation-timing", "Generation Timing", [
      {
        id: "generation-timing-empty",
        label: "Generation timings",
        status: "unknown",
        summary: "No generation timing diagnostics captured yet. Enable debug mode and run a generation.",
      },
    ]);
  }

  const slowest = timings.reduce((current, timing) => (timing.durationMs > current.durationMs ? timing : current));
  const mode = [slowest.chatMode, slowest.groupChatMode].filter(Boolean).join(" ");
  const characterText = slowest.characterCount === 1 ? "1 character" : `${slowest.characterCount} characters`;
  return section("generation-timing", "Generation Timing", [
    {
      id: "generation-timing-slowest",
      label: "Slowest recent generation stage",
      status: generationTimingStatus(slowest.durationMs),
      summary: `${slowest.name} took ${formatTimingDuration(slowest.durationMs)} in ${mode || "unknown"} mode with ${characterText}.`,
      details: {
        slowestStage: slowest.name,
        durationMs: slowest.durationMs,
        chatId: slowest.chatId,
        chatMode: slowest.chatMode,
        groupChatMode: slowest.groupChatMode,
        characterCount: slowest.characterCount,
        targetCharacterId: slowest.targetCharacterId,
        messageCount: slowest.messageCount,
        promptMessageCount: slowest.promptMessageCount,
        savedUserMessage: slowest.savedUserMessage,
        timestamp: slowest.timestamp,
        recentTimings: timings.slice(0, 10),
      },
    },
  ]);
}

export function buildTroubleshootingPacket(
  snapshot: DiagnosticsSnapshot,
  generatedAt = new Date(),
): TroubleshootingPacket {
  const packet: TroubleshootingPacket = {
    schema: "de-koi-diagnostics.v1",
    generatedAt: generatedAt.toISOString(),
    appVersion: snapshot.appVersion,
    platform: snapshot.platform,
    logTail: snapshot.logTail,
    runtimeMode: snapshot.runtimeMode,
    overallStatus: snapshot.overallStatus,
    sections: snapshot.sections,
    recentDiagnostics: snapshot.recentDiagnostics,
  };
  return redactDiagnosticsValue(packet) as TroubleshootingPacket;
}

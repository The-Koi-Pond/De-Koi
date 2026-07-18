import type { ClientDiagnosticRecord } from "../../../../shared/lib/client-diagnostics";
import { redactSensitiveValue } from "../../../../shared/lib/sensitive-data-redaction";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function section(id: string, title: string, items: DiagnosticItem[]): DiagnosticsSection {
  return {
    id,
    title,
    status: diagnosticsOverallStatus(items),
    items,
  };
}

export function redactDiagnosticsValue(value: unknown): unknown {
  return redactSensitiveValue(value);
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

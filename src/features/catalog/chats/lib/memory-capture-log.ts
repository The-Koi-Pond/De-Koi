// Turns a chat's memory capture job rows into the Memory Console's capture log: what each reply saved,
// what it skipped and why, and which replies were never checked.
import type {
  MemoryCaptureNotCheckedReason,
  MemoryCaptureReport,
  MemoryCaptureSkip,
  MemoryCaptureSkipReason,
} from "../../../../engine/contracts/types/chat";

export const MEMORY_CAPTURE_LOG_FIELDS = [
  "id",
  "chatId",
  "status",
  "createdAt",
  "completedAt",
  "updatedAt",
  "attempts",
  "lastError",
  "staleReason",
  "notCheckedReason",
  "captureReport",
  "affectedCanonicalMemoryIds",
];

export const MEMORY_CAPTURE_LOG_LIMIT = 100;

type MemoryCaptureLogEntryState = "saved" | "nothing_new" | "not_checked" | "in_progress" | "no_details";

export interface MemoryCaptureLogEntry {
  jobId: string;
  at: string;
  state: MemoryCaptureLogEntryState;
  saved: number;
  savedInactive: number;
  skippedTotal: number;
  skipped: MemoryCaptureSkip[];
  notCheckedReason: MemoryCaptureNotCheckedReason | null;
  error: string | null;
}

export interface MemoryCaptureLogSummary {
  checked: number;
  saved: number;
  savedInactive: number;
  skipped: number;
  notChecked: number;
  inProgress: number;
  // Replies captured before skip reasons were recorded.
  withoutDetails: number;
}

export const MEMORY_CAPTURE_SKIP_COPY: Record<MemoryCaptureSkipReason, string> = {
  malformed_response: "The memory model's answer had no memory list.",
  malformed_candidate: "The memory model sent a broken entry.",
  over_limit: "More than 12 memories from one reply; the extra ones were dropped.",
  unknown_kind: "Not a kind of memory De-Koi keeps.",
  empty_content: "The memory was empty.",
  too_long: "Longer than 500 characters.",
  unknown_evidence: "It gave no valid kind of evidence.",
  no_source_rows: "It didn't point to a message in this exchange.",
  unknown_source_row: "It pointed to a message outside this exchange.",
  unknown_reference_row: "It pointed to an older message it wasn't shown.",
  evidence_mismatch:
    "Facts and preferences are only saved from your own messages, and this one came from somewhere else.",
  not_in_cited_rows: "Its words don't appear in the messages it pointed to.",
  unknown_supersedes: "It tried to replace a memory that isn't there.",
  wording_uncorrected: 'Its wording broke a rule (a pronoun, or "User" as a name) and couldn\'t be fixed.',
  verifier_rejected: "The fact check said it doesn't match what was said.",
  verifier_unusable: "The fact check sent an unusable answer, so nothing it checked was kept.",
  low_value: "Judged not worth remembering.",
  duplicate: "Same as another memory from this reply.",
};

export const MEMORY_CAPTURE_NOT_CHECKED_COPY: Record<MemoryCaptureNotCheckedReason, string> = {
  no_reply_text: "The reply had no text.",
  enqueue_failed: "It couldn't be queued for memory.",
  missing_source_snapshot: "The messages were missing when memory ran.",
  source_message_deleted: "A message was deleted before memory ran.",
  source_chat_changed: "A message moved to another chat before memory ran.",
  source_role_changed: "A message changed before memory ran.",
  source_content_changed: "A message was edited before memory ran.",
  source_character_changed: "A message changed speaker before memory ran.",
  transcript_changed: "The messages changed while memory was running.",
  configuration_error: "The memory model's connection isn't set up right.",
  route_unavailable:
    "Helper Models sends memory to a connection that's missing or not ready. Fix it in Connections → Helper Models.",
  provider_error: "The memory model kept failing (3 tries).",
};

const NOT_CHECKED_REASONS = new Set(Object.keys(MEMORY_CAPTURE_NOT_CHECKED_COPY));
const SKIP_REASONS = new Set(Object.keys(MEMORY_CAPTURE_SKIP_COPY));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function notCheckedReason(value: unknown): MemoryCaptureNotCheckedReason | null {
  const reason = text(value);
  return NOT_CHECKED_REASONS.has(reason) ? (reason as MemoryCaptureNotCheckedReason) : null;
}

function captureReport(value: unknown): MemoryCaptureReport | null {
  const report = record(value);
  if (report.version !== 1) return null;
  const skipped = (Array.isArray(report.skipped) ? report.skipped : [])
    .map(record)
    .filter((skip) => SKIP_REASONS.has(text(skip.reason)))
    .map(
      (skip): MemoryCaptureSkip => ({
        reason: text(skip.reason) as MemoryCaptureSkipReason,
        ...(text(skip.kind) ? { kind: text(skip.kind) } : {}),
        ...(text(skip.content) ? { content: text(skip.content) } : {}),
        ...(skip.afterCorrection === true ? { afterCorrection: true } : {}),
      }),
    );
  const transcript = text(report.transcript);
  return {
    version: 1,
    proposed: count(report.proposed),
    saved: count(report.saved),
    savedInactive: count(report.savedInactive),
    corrected: count(report.corrected),
    skippedTotal: Math.max(count(report.skippedTotal), skipped.length),
    skipped,
    transcript: transcript === "saved" || transcript === "low_value" ? transcript : "none",
  };
}

function memoryCaptureLogEntry(job: unknown): MemoryCaptureLogEntry | null {
  const row = record(job);
  const jobId = text(row.id);
  if (!jobId) return null;
  const status = text(row.status);
  const at = text(row.completedAt) || text(row.updatedAt) || text(row.createdAt);
  const base: MemoryCaptureLogEntry = {
    jobId,
    at,
    state: "in_progress",
    saved: 0,
    savedInactive: 0,
    skippedTotal: 0,
    skipped: [],
    notCheckedReason: null,
    error: null,
  };
  if (status === "stale") {
    return { ...base, state: "not_checked", notCheckedReason: notCheckedReason(row.staleReason) };
  }
  if (status === "failed") {
    return {
      ...base,
      state: "not_checked",
      // Failed rows written before reasons were recorded show their raw error instead.
      notCheckedReason: notCheckedReason(row.notCheckedReason),
      error: text(row.lastError) || null,
    };
  }
  if (status !== "completed") return { ...base, error: status === "retryable" ? text(row.lastError) || null : null };
  const report = captureReport(row.captureReport);
  if (!report) {
    const saved = Array.isArray(row.affectedCanonicalMemoryIds) ? row.affectedCanonicalMemoryIds.length : 0;
    return { ...base, state: "no_details", saved };
  }
  return {
    ...base,
    state: report.saved + report.savedInactive > 0 ? "saved" : "nothing_new",
    saved: report.saved,
    savedInactive: report.savedInactive,
    skippedTotal: report.skippedTotal,
    skipped: report.skipped,
  };
}

export function memoryCaptureLog(jobs: unknown[]): {
  entries: MemoryCaptureLogEntry[];
  summary: MemoryCaptureLogSummary;
} {
  const entries = jobs
    .map(memoryCaptureLogEntry)
    .filter((entry): entry is MemoryCaptureLogEntry => entry !== null)
    .sort((left, right) => right.at.localeCompare(left.at) || left.jobId.localeCompare(right.jobId));
  const summary: MemoryCaptureLogSummary = {
    checked: 0,
    saved: 0,
    savedInactive: 0,
    skipped: 0,
    notChecked: 0,
    inProgress: 0,
    withoutDetails: 0,
  };
  for (const entry of entries) {
    if (entry.state === "in_progress") summary.inProgress += 1;
    else if (entry.state === "not_checked") summary.notChecked += 1;
    else summary.checked += 1;
    if (entry.state === "no_details") summary.withoutDetails += 1;
    summary.saved += entry.saved;
    summary.savedInactive += entry.savedInactive;
    summary.skipped += entry.skippedTotal;
  }
  return { entries, summary };
}

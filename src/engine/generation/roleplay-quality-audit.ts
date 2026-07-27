import type { AgentResult } from "../contracts/types/agent";
import type { RoleplayQualitySignal, RoleplayQualitySignalKind } from "./roleplay-quality-signals";
import { isRecord, parseArray, readString } from "./runtime-records";

export type RoleplayQualityChangeReason = "agency" | "continuity" | "repetition" | "pacing" | "malformed";

export interface RoleplayQualityRepair {
  content: string;
  changed: boolean;
  reasons: RoleplayQualityChangeReason[];
  evidence: string[];
  durationMs: number;
}

export interface RoleplayQualityAuditValidationOptions {
  allowedReasons?: RoleplayQualityChangeReason[];
}

interface PositionedReplacement {
  before: string;
  after: string;
  reason: RoleplayQualityChangeReason;
  start: number;
  end: number;
}

const CHANGE_REASONS = new Set<RoleplayQualityChangeReason>([
  "agency",
  "continuity",
  "repetition",
  "pacing",
  "malformed",
]);
const MAX_AUDIT_EDITS = 6;
const MAX_EVIDENCE_LENGTH = 240;
const INTERNAL_OUTPUT_PATTERN =
  /<\/?(?:analysis|assistant_response|roleplay_quality|roleplay_quality_audit)\b|^\s*```(?:json)?/i;
const SIGNAL_REASONS: Record<RoleplayQualitySignalKind, RoleplayQualityChangeReason> = {
  agency_candidate: "agency",
  identity_contradiction: "continuity",
  repeated_phrase: "repetition",
  repeated_opening: "repetition",
  repeated_closing: "repetition",
  repeated_gesture: "repetition",
  user_echo: "repetition",
  rhetorical_repetition: "repetition",
  cast_saturation: "pacing",
  length_mismatch: "pacing",
  malformed_output: "malformed",
};

function unchanged(original: string, durationMs: number): RoleplayQualityRepair {
  return { content: original, changed: false, reasons: [], evidence: [], durationMs };
}

function comparable(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function boundedEvidence(value: string): string {
  const compact = comparable(value);
  return compact.length <= MAX_EVIDENCE_LENGTH ? compact : `${compact.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`;
}

function structuredOutput(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function exactOccurrences(source: string, excerpt: string): number[] {
  const indexes: number[] = [];
  for (let index = source.indexOf(excerpt); index >= 0; index = source.indexOf(excerpt, index + 1)) {
    indexes.push(index);
  }
  return indexes;
}

function hasOverlaps(edits: PositionedReplacement[]): boolean {
  return edits.some((edit, index) => index > 0 && edit.start < edits[index - 1]!.end);
}

export function roleplayQualityReasonsForSignals(signals: RoleplayQualitySignal[]): RoleplayQualityChangeReason[] {
  const reasons: RoleplayQualityChangeReason[] = [];
  for (const signal of signals) {
    const reason = SIGNAL_REASONS[signal.kind];
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

export function validateRoleplayQualityAudit(
  original: string,
  result: AgentResult,
  options: RoleplayQualityAuditValidationOptions = {},
): RoleplayQualityRepair {
  const durationMs = Math.max(0, result.durationMs || 0);
  if (!result.success || result.type !== "text_rewrite" || !isRecord(result.data)) {
    return unchanged(original, durationMs);
  }

  const rawEdits = parseArray(result.data.edits);
  if (rawEdits.length === 0 || rawEdits.length > MAX_AUDIT_EDITS || rawEdits.some((entry) => !isRecord(entry))) {
    return unchanged(original, durationMs);
  }

  const allowedReasons = new Set(options.allowedReasons ?? CHANGE_REASONS);
  const positioned: PositionedReplacement[] = [];
  const reasons: RoleplayQualityChangeReason[] = [];
  const evidence: string[] = [];

  for (const rawEdit of rawEdits) {
    const edit = isRecord(rawEdit) ? rawEdit : {};
    const before = readString(edit.before);
    const after = typeof edit.after === "string" ? edit.after : null;
    const reason = readString(edit.reason).trim() as RoleplayQualityChangeReason;
    const description = readString(edit.description).trim();
    const indexes = before ? exactOccurrences(original, before) : [];
    if (
      !before ||
      after === null ||
      before === after ||
      !CHANGE_REASONS.has(reason) ||
      !allowedReasons.has(reason) ||
      !description ||
      // Reject the whole batch when the editor ignored the unique-span contract.
      // Applying only the other edits would hide a malformed correction request.
      indexes.length !== 1 ||
      INTERNAL_OUTPUT_PATTERN.test(after) ||
      structuredOutput(after)
    ) {
      return unchanged(original, durationMs);
    }

    const start = indexes[0]!;
    positioned.push({ before, after, reason, start, end: start + before.length });
    if (!reasons.includes(reason)) reasons.push(reason);
    const source = boundedEvidence(before);
    if (source && !evidence.includes(source)) evidence.push(source);
  }

  positioned.sort((left, right) => left.start - right.start);
  if (hasOverlaps(positioned)) return unchanged(original, durationMs);

  let edited = original;
  for (const replacement of [...positioned].sort((left, right) => right.start - left.start)) {
    edited = edited.slice(0, replacement.start) + replacement.after + edited.slice(replacement.end);
  }
  if (!edited.trim() || edited.length > original.length || comparable(edited) === comparable(original)) {
    return unchanged(original, durationMs);
  }

  return {
    content: edited,
    changed: true,
    reasons,
    evidence,
    durationMs,
  };
}

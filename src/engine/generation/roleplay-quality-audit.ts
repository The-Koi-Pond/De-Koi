import type { AgentResult } from "../contracts/types/agent";
import { isRecord, parseArray, readString } from "./runtime-records";

export type RoleplayQualityChangeReason = "agency" | "continuity" | "repetition";

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

const CHANGE_REASONS = new Set<RoleplayQualityChangeReason>(["agency", "continuity", "repetition"]);
const MAX_EVIDENCE_LENGTH = 240;
const INTERNAL_OUTPUT_PATTERN =
  /<\/?(?:assistant_response|roleplay_quality|roleplay_quality_audit)\b|^\s*```(?:json)?|^\s*\{\s*"editedText"/i;

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

function duplicatesOriginal(original: string, edited: string): boolean {
  const normalizedOriginal = comparable(original);
  const normalizedEdited = comparable(edited);
  return normalizedEdited.length > normalizedOriginal.length && normalizedEdited.includes(normalizedOriginal);
}

function structuredOutput(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function sourceBackedEvidence(original: string, evidence: string): boolean {
  const normalizedEvidence = comparable(evidence).toLowerCase();
  return normalizedEvidence.length >= 4 && comparable(original).toLowerCase().includes(normalizedEvidence);
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
  const editedText = readString(result.data.editedText).trim();
  const rawChanges = parseArray(result.data.changes);
  if (
    !editedText ||
    INTERNAL_OUTPUT_PATTERN.test(editedText) ||
    structuredOutput(editedText) ||
    duplicatesOriginal(original, editedText) ||
    rawChanges.some((entry) => !isRecord(entry))
  ) {
    return unchanged(original, durationMs);
  }
  if (comparable(editedText) === comparable(original)) return unchanged(original, durationMs);
  if (rawChanges.length === 0) return unchanged(original, durationMs);

  const reasons: RoleplayQualityChangeReason[] = [];
  const evidence: string[] = [];
  const allowedReasons = new Set(options.allowedReasons ?? CHANGE_REASONS);
  for (const rawChange of rawChanges) {
    const change = isRecord(rawChange) ? rawChange : {};
    const reason = readString(change.reason).trim() as RoleplayQualityChangeReason;
    const description = readString(change.description).trim();
    const rawSource = readString(change.evidence);
    const source = boundedEvidence(rawSource);
    if (
      !CHANGE_REASONS.has(reason) ||
      !allowedReasons.has(reason) ||
      !description ||
      !source ||
      !sourceBackedEvidence(original, rawSource)
    ) {
      return unchanged(original, durationMs);
    }
    if (!reasons.includes(reason)) reasons.push(reason);
    if (!evidence.includes(source)) evidence.push(source);
  }

  return {
    content: editedText,
    changed: true,
    reasons,
    evidence,
    durationMs,
  };
}

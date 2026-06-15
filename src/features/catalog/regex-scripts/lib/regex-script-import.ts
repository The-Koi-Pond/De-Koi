import {
  createRegexScriptSchema,
  type CreateRegexScriptInput,
} from "../../../../engine/contracts/schemas/regex.schema";
import { regexScriptTargetCharacterIds } from "./regex-script-filter";

type RegexScriptImportComparable = Omit<
  Partial<CreateRegexScriptInput>,
  "enabled" | "promptOnly" | "trimStrings" | "placement" | "targetCharacterIds"
> & {
  id?: string;
  enabled?: boolean | string;
  promptOnly?: boolean | string;
  trimStrings?: unknown;
  placement?: unknown;
  targetCharacterIds?: unknown;
};

export type RegexScriptImportWriteResult = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  pending: number;
};

class RegexScriptImportWriteError extends Error {
  readonly result: RegexScriptImportWriteResult;

  constructor(result: RegexScriptImportWriteResult, cause: unknown) {
    super(formatRegexScriptImportError(result, cause));
    this.name = "RegexScriptImportWriteError";
    this.result = result;
  }
}

const ST_PLACEMENT_MAP: Record<number, "user_input" | "ai_output"> = {
  1: "user_input",
  2: "ai_output",
};

function normalizedStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return normalizedStringArray(JSON.parse(trimmed) as unknown);
  } catch {
    return [trimmed];
  }
}

function normalizedPlacement(value: unknown): string[] {
  return normalizedStringArray(value)
    .filter((placement) => placement === "ai_output" || placement === "user_input")
    .sort();
}

function boolish(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return fallback;
}

function importedRegexName(row: Record<string, unknown>): string {
  const value = typeof row.name === "string" ? row.name : typeof row.scriptName === "string" ? row.scriptName : "";
  return value.trim();
}

function parseDelimitedRegex(value: string): { pattern: string; flags?: string } {
  const delimited = value.match(/^\/(.+)\/([gimsuy]*)$/s);
  if (!delimited) return { pattern: value };
  return { pattern: delimited[1] ?? "", flags: delimited[2] || "g" };
}

function importedRegexPlacement(row: Record<string, unknown>): Array<"ai_output" | "user_input"> {
  if (!Array.isArray(row.placement)) return ["ai_output"];
  const mapped = row.placement
    .map((placement) => (typeof placement === "number" ? ST_PLACEMENT_MAP[placement] : placement))
    .filter((placement): placement is "ai_output" | "user_input" => placement === "ai_output" || placement === "user_input");
  return mapped.length > 0 ? mapped : ["ai_output"];
}

function importedEnabled(row: Record<string, unknown>): boolean {
  if (typeof row.enabled === "boolean") return row.enabled;
  if (typeof row.enabled === "string") return row.enabled !== "false";
  if (typeof row.disabled === "boolean") return !row.disabled;
  return true;
}

function toRegexScriptPayload(row: Record<string, unknown>): CreateRegexScriptInput | null {
  const name = importedRegexName(row);
  const rawFindRegex = typeof row.findRegex === "string" ? row.findRegex : "";
  const { pattern: findRegex, flags: delimitedFlags } = parseDelimitedRegex(rawFindRegex);
  if (!name || !findRegex) return null;

  const targetCharacterIds = regexScriptTargetCharacterIds(row);
  return createRegexScriptSchema.parse({
    name,
    enabled: importedEnabled(row),
    findRegex,
    characterId: targetCharacterIds[0] ?? null,
    targetCharacterIds,
    replaceString: row.replaceString ?? "",
    trimStrings: row.trimStrings ?? [],
    placement: importedRegexPlacement(row),
    flags: delimitedFlags ?? (typeof row.flags === "string" ? row.flags : "gi"),
    promptOnly: row.promptOnly ?? false,
    order: row.order ?? 0,
    minDepth: row.minDepth ?? null,
    maxDepth: row.maxDepth ?? null,
  });
}

export function parseRegexScriptImportPayloads(parsed: unknown): CreateRegexScriptInput[] {
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length === 0) throw new Error("No regex scripts found in file");

  const payloads: CreateRegexScriptInput[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const payload = toRegexScriptPayload(row as Record<string, unknown>);
    if (payload) payloads.push(payload);
  }

  return payloads;
}

function regexScriptImportSignature(script: RegexScriptImportComparable): string {
  return JSON.stringify({
    name: script.name ?? "",
    enabled: boolish(script.enabled, true),
    findRegex: script.findRegex ?? "",
    replaceString: script.replaceString ?? "",
    trimStrings: normalizedStringArray(script.trimStrings),
    placement: normalizedPlacement(script.placement),
    flags: script.flags ?? "gi",
    promptOnly: boolish(script.promptOnly, false),
    order: script.order ?? 0,
    minDepth: script.minDepth ?? null,
    maxDepth: script.maxDepth ?? null,
    targetCharacterIds: regexScriptTargetCharacterIds(script),
  });
}

export function formatRegexScriptImportResult(result: RegexScriptImportWriteResult): string {
  const parts = [`Imported ${result.created} regex script${result.created === 1 ? "" : "s"}.`];
  if (result.skipped > 0) parts.push(`Skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}.`);
  return parts.join(" ");
}

export function reconcileRegexScriptImportPendingSignatures(
  pendingSignatures: Set<string>,
  durableScripts?: RegexScriptImportComparable[],
): void {
  for (const script of durableScripts ?? []) {
    pendingSignatures.delete(regexScriptImportSignature(script));
  }
}

function formatRegexScriptImportError(result: RegexScriptImportWriteResult, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Failed to import regex scripts";
  return [
    `Imported ${result.created} regex script${result.created === 1 ? "" : "s"}`,
    `skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}`,
    `failed ${result.failed}`,
    `left ${result.pending} unattempted`,
    message,
  ].join("; ");
}

export async function writeRegexScriptImportPayloads({
  payloads,
  existingScripts,
  pendingSignatures,
  create,
}: {
  payloads: CreateRegexScriptInput[];
  existingScripts?: RegexScriptImportComparable[];
  pendingSignatures?: Set<string>;
  create: (payload: CreateRegexScriptInput) => Promise<unknown>;
}): Promise<RegexScriptImportWriteResult> {
  const seen = new Set(pendingSignatures);
  for (const script of existingScripts ?? []) {
    seen.add(regexScriptImportSignature(script));
  }

  let created = 0;
  let skipped = 0;
  for (const [index, payload] of payloads.entries()) {
    const signature = regexScriptImportSignature(payload);
    if (seen.has(signature)) {
      skipped++;
      continue;
    }

    try {
      await create(payload);
      created++;
      seen.add(signature);
      pendingSignatures?.add(signature);
    } catch (error) {
      throw new RegexScriptImportWriteError(
        {
          total: payloads.length,
          created,
          skipped,
          failed: 1,
          pending: payloads.length - index - 1,
        },
        error,
      );
    }
  }

  return { total: payloads.length, created, skipped, failed: 0, pending: 0 };
}

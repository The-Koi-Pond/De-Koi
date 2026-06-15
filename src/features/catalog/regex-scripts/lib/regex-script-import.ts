import {
  createRegexScriptSchema,
  type CreateRegexScriptInput,
} from "../../../../engine/contracts/schemas/regex.schema";
import { regexScriptTargetCharacterIds } from "./regex-script-filter";

const ST_PLACEMENT_MAP: Record<number, "user_input" | "ai_output"> = {
  1: "user_input",
  2: "ai_output",
};

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

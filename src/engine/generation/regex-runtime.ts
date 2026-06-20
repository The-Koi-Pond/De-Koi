import { applyRegexScriptReplacement } from "../shared/regex/regex-script-application";
import type { StorageGateway } from "../capabilities/storage";
import { bySortOrder, boolish, readString, stringArray, type JsonRecord } from "./runtime-records";

type RegexPlacement = "user_input" | "ai_output";
type RuntimeRegexScopeOptions = {
  targetCharacterId?: string | null;
  chatCharacterIds?: string[];
};

function placements(value: unknown): RegexPlacement[] {
  const raw = stringArray(value);
  if (raw.length > 0) {
    return raw.filter((entry): entry is RegexPlacement => entry === "user_input" || entry === "ai_output");
  }
  return value === "user_input" || value === "ai_output" ? [value] : [];
}

function flagsForScript(script: JsonRecord): string {
  const flags = readString(script.flags);
  return Array.from(new Set(flags.split("").filter((flag) => "dgimsuvy".includes(flag)))).join("");
}

function scriptTargetCharacterIds(script: JsonRecord): string[] {
  const targetCharacterIds = stringArray(script.targetCharacterIds);
  if (targetCharacterIds.length > 0) return Array.from(new Set(targetCharacterIds));
  const characterId = readString(script.characterId).trim();
  return characterId ? [characterId] : [];
}

function scriptPromptOnly(script: JsonRecord): boolean {
  return boolish(script.promptOnly, false) || scriptTargetCharacterIds(script).length > 0;
}

function scriptAppliesToScope(script: JsonRecord, options?: RuntimeRegexScopeOptions): boolean {
  const targetIds = scriptTargetCharacterIds(script);
  if (targetIds.length === 0) return true;
  const targetCharacterId = readString(options?.targetCharacterId).trim();
  if (targetCharacterId) return targetIds.includes(targetCharacterId);
  const chatCharacterIds = new Set((options?.chatCharacterIds ?? []).map((id) => id.trim()).filter(Boolean));
  return chatCharacterIds.size > 0 && targetIds.some((id) => chatCharacterIds.has(id));
}

export async function applyRuntimeRegexScripts(
  storage: StorageGateway,
  placement: RegexPlacement,
  input: string,
  options?: RuntimeRegexScopeOptions,
): Promise<string> {
  if (!input) return input;

  const scripts = (await storage.list<JsonRecord>("regex-scripts")).sort(bySortOrder);
  let output = input;

  for (const script of scripts) {
    if (!boolish(script.enabled, true)) continue;
    if (scriptPromptOnly(script)) continue;
    if (!scriptAppliesToScope(script, options)) continue;
    if (!placements(script.placement).includes(placement)) continue;

    const findRegex = readString(script.findRegex);
    if (!findRegex.trim()) continue;

    try {
      const re = new RegExp(findRegex, flagsForScript(script));
      const replacement = readString(script.replaceString);
      output = applyRegexScriptReplacement(output, re, replacement, stringArray(script.trimStrings));
    } catch {
      // Invalid user regexes are ignored during generation; the editor remains the validation surface.
    }
  }

  return output;
}

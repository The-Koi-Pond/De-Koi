import { estimateTextTokens } from "../../lib/card-token-recommendation";
import type { PersonaFormData } from "./persona-editor-model";

export type PersonaTokenData = Partial<
  Pick<PersonaFormData, "name" | "comment" | "description" | "personality" | "backstory" | "appearance" | "scenario">
> & {
  altDescriptions?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function collectString(value: unknown, output: string[]): void {
  const text = asString(value);
  if (text) output.push(text);
}

function collectActiveAltDescriptions(value: unknown, output: string[]): void {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as { active?: unknown; content?: unknown };
    if (entry.active !== true) continue;
    collectString(entry.content, output);
  }
}

export function estimatePersonaCardTokens(data: PersonaTokenData | null | undefined): number {
  if (!data) return 0;
  const textParts: string[] = [];

  collectString(data.name, textParts);
  collectString(data.description, textParts);
  collectString(data.personality, textParts);
  collectString(data.backstory, textParts);
  collectString(data.appearance, textParts);
  collectString(data.scenario, textParts);
  collectActiveAltDescriptions(data.altDescriptions, textParts);

  return estimateTextTokens(textParts.join("\n"));
}

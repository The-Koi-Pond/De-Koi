import { parseRecord } from "./runtime-records";

export type CharacterWebResearchPresentation = "quiet" | "visible";

const CHARACTER_WEB_TOOL_NAMES = new Set([
  "request_character_web_research",
  "search_character_web",
  "read_character_web_page",
]);

export function characterWebResearchPresentation(metadata: unknown): CharacterWebResearchPresentation {
  return parseRecord(metadata).characterWebResearchPresentation === "visible" ? "visible" : "quiet";
}

export function isCharacterWebToolName(name: string): boolean {
  return CHARACTER_WEB_TOOL_NAMES.has(name);
}

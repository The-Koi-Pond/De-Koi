import type { CharacterData } from "../../../../engine/contracts/types/character";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean) : [];
}

function labelledLine(label: string, value: unknown): string {
  const text = readText(value);
  return text ? `${label}:\n${text}` : "";
}

export function characterLorebookName(data: CharacterData): string {
  const name = readText(data.name);
  return name ? `${name} Lorebook` : "Character Lorebook";
}

export function buildCharacterLorebookPrompt(data: CharacterData): string {
  const extensions = readRecord(data.extensions);
  const depthPrompt = readRecord(extensions.depth_prompt);
  const tags = readTextArray(data.tags);
  const characterName = readText(data.name) || "Unnamed Character";
  const context = [
    `Character name:\n${characterName}`,
    labelledLine("Description", data.description),
    labelledLine("Personality", data.personality),
    labelledLine("Backstory", extensions.backstory),
    labelledLine("Appearance", extensions.appearance),
    labelledLine("Scenario", data.scenario),
    labelledLine("Opening message", data.first_mes),
    labelledLine("Example conversation", data.mes_example),
    labelledLine("System prompt", data.system_prompt),
    labelledLine("Post-history instructions", data.post_history_instructions),
    labelledLine("Creator notes", data.creator_notes),
    tags.length > 0 ? `Tags:\n${tags.join(", ")}` : "",
    readText(depthPrompt.prompt) ? `Depth prompt:\n${readText(depthPrompt.prompt)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    "Create a lorebook for this character.",
    "Prefer entries that help roleplay this character: important places, factions, relationships, secrets, artifacts, rules, recurring vocabulary, and continuity hooks.",
    "Make entries useful for keyword-triggered conversation context rather than rewriting the character card.",
    "",
    context,
  ].join("\n");
}

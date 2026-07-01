import type { LlmChunk, LlmGateway, LlmMessage } from "../../../../engine/capabilities/llm";
import type { CharacterData, RPGStatsConfig } from "../../../../engine/contracts/types/character";
import { parseGameJsonish } from "../../../../engine/shared/parsing-jsonish";

export type CharacterRpgStatsGenerationInput = {
  data: CharacterData;
  comment?: string | null;
};

export type GenerateCharacterRpgStatsInput = CharacterRpgStatsGenerationInput & {
  connectionId: string;
  llm: Pick<LlmGateway, "stream">;
  signal?: AbortSignal;
};

type GeneratedAttribute = {
  name?: unknown;
  value?: unknown;
};

type GeneratedStatsRecord = {
  hp?: unknown;
  maxHp?: unknown;
  max_hp?: unknown;
  attributes?: unknown;
  stats?: unknown;
};

const ATTRIBUTE_ALIASES: Record<string, string> = {
  STRENGTH: "STR",
  DEXTERITY: "DEX",
  CONSTITUTION: "CON",
  INTELLIGENCE: "INT",
  WISDOM: "WIS",
  CHARISMA: "CHA",
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelledLine(label: string, value: unknown): string {
  const text = readText(value);
  return text ? `${label}:\n${text}` : "";
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function parseJsonRecord(raw: string): GeneratedStatsRecord {
  try {
    const parsed = parseGameJsonish(stripMarkdownFence(raw));
    return readRecord(parsed) as GeneratedStatsRecord;
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeAttributeName(value: unknown): string {
  const name = readText(value)
    .replace(/[^a-z0-9 _-]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return "";
  const upper = name.toUpperCase();
  return ATTRIBUTE_ALIASES[upper] ?? upper.slice(0, 16);
}

function readMaxHp(record: GeneratedStatsRecord): number | null {
  const hp = readRecord(record.hp);
  return numberValue(hp.max) ?? numberValue(hp.value) ?? numberValue(record.maxHp) ?? numberValue(record.max_hp);
}

function readAttributes(record: GeneratedStatsRecord): GeneratedAttribute[] {
  const source = Array.isArray(record.attributes) ? record.attributes : Array.isArray(record.stats) ? record.stats : [];
  return source.filter(
    (item): item is GeneratedAttribute => !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function chunkText(chunk: LlmChunk): string {
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.data === "string") return chunk.data;
  const data = readRecord(chunk.data);
  return (
    readText((chunk as { message?: unknown }).message) ||
    readText((chunk as { error?: unknown }).error) ||
    readText(data.message) ||
    readText(data.error)
  );
}

export function buildCharacterRpgStatsGenerationMessages(input: CharacterRpgStatsGenerationInput): LlmMessage[] {
  const tags = readTextArray(input.data.tags);
  const context = [
    labelledLine("Character name", input.data.name),
    labelledLine("Profile title/comment", input.comment),
    labelledLine("Description", input.data.description),
    labelledLine("Personality", input.data.personality),
    labelledLine("Backstory", input.data.extensions.backstory),
    labelledLine("Appearance", input.data.extensions.appearance),
    labelledLine("Scenario", input.data.scenario),
    labelledLine("Opening message", input.data.first_mes),
    labelledLine("Example conversation", input.data.mes_example),
    tags.length > 0 ? `Tags:\n${tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "You are an RPG stat designer for De-Koi character cards.",
        "Create balanced initial RPG stats that fit the supplied character.",
        "Return JSON only. Do not explain, add markdown, or include alternatives.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        'Return exactly this JSON shape: { "hp": { "max": number }, "attributes": [{ "name": "STR", "value": number }] }.',
        "Use 4-8 attributes. Prefer familiar short names such as STR, DEX, CON, INT, WIS, CHA when they fit.",
        "Use whole numbers. Typical human-scale attributes are 6-18; exceptional characters can go higher when justified.",
        "Set HP max to a practical starting value for this character's toughness.",
        "",
        "Character context:",
        context || "No additional character context was provided.",
      ].join("\n"),
    },
  ];
}

export function cleanGeneratedRpgStatsConfig(raw: string): RPGStatsConfig {
  const record = parseJsonRecord(raw);
  const maxHp = readMaxHp(record);
  const attributes = readAttributes(record);
  const seen = new Set<string>();
  const cleanedAttributes = attributes
    .map((attribute) => {
      const name = normalizeAttributeName(attribute.name);
      const value = numberValue(attribute.value);
      if (!name || value == null || seen.has(name)) return null;
      seen.add(name);
      return { name, value: clampInteger(value, 0, 100) };
    })
    .filter((attribute): attribute is { name: string; value: number } => attribute !== null);

  if (maxHp == null || cleanedAttributes.length === 0) {
    throw new Error("Provider did not return valid RPG stats.");
  }

  const hpMax = clampInteger(maxHp, 1, 9999);
  return {
    enabled: true,
    hp: { value: hpMax, max: hpMax },
    attributes: cleanedAttributes,
  };
}

export async function generateCharacterRpgStatsConfig(input: GenerateCharacterRpgStatsInput): Promise<RPGStatsConfig> {
  if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  const rawParts: string[] = [];
  const request = {
    connectionId: input.connectionId,
    messages: buildCharacterRpgStatsGenerationMessages(input),
    parameters: { temperature: 0.75, maxTokens: 1024, responseFormat: "json_object" },
  };

  for await (const chunk of input.llm.stream(request, input.signal)) {
    if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const text = chunkText(chunk);
    if (chunk.type === "error") throw new Error(text || "RPG stats generation failed");
    if (chunk.type === "token" && text) rawParts.push(text);
  }

  return cleanGeneratedRpgStatsConfig(rawParts.join(""));
}

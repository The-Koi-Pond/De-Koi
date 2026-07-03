import type { LlmChunk, LlmGateway, LlmMessage } from "../../../../engine/capabilities/llm";
import type { CharacterData, DepthPrompt } from "../../../../engine/contracts/types/character";

export type CharacterFieldGenerationField =
  | "description"
  | "personality"
  | "backstory"
  | "appearance"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions"
  | "creator_notes"
  | "tags"
  | "depth_prompt";

export type CharacterFieldGenerationValue = string | string[] | DepthPrompt;

export type CharacterFieldGenerationInput = {
  data: CharacterData;
  comment?: string | null;
};

export type GenerateCharacterFieldInput = CharacterFieldGenerationInput & {
  field: CharacterFieldGenerationField;
  connectionId: string;
  llm: Pick<LlmGateway, "stream">;
  signal?: AbortSignal;
};

export const CHARACTER_FIELD_LABELS: Record<CharacterFieldGenerationField, string> = {
  description: "Description",
  personality: "Personality",
  backstory: "Backstory",
  appearance: "Appearance",
  scenario: "Scenario",
  first_mes: "First Message",
  mes_example: "Example Dialogue",
  system_prompt: "System Prompt",
  post_history_instructions: "Post-History Instructions",
  creator_notes: "Creator Notes",
  tags: "Tags",
  depth_prompt: "Depth Prompt",
};

const FIELD_INSTRUCTIONS: Record<CharacterFieldGenerationField, string> = {
  description:
    "Write a rich character description in 2-4 compact paragraphs. Include identity, role, motivations, mannerisms, and speech patterns. Return only the description text.",
  personality:
    "Write a concise personality summary with core traits, temperament, quirks, and behavioral patterns. Return only the personality text.",
  backstory:
    "Write the character's history, origin, and formative events in 2-3 compact paragraphs. Return only the backstory text.",
  appearance:
    "Write a detailed physical description: height, build, hair, eyes, clothing, posture, and distinguishing features. Return only the appearance text.",
  scenario:
    "Write the default setting or situation where interactions with this character begin. Return only the scenario text.",
  first_mes:
    "Write the character's opening message in their voice. Use *asterisks* for actions. Keep it to 1-3 paragraphs. Return only the first message.",
  mes_example:
    "Write 2-3 example dialogue exchanges. Use this format exactly: <START>\\n{{user}}: message\\n{{char}}: reply. Return only the example dialogue.",
  system_prompt:
    "Write character-specific system instructions that help an AI roleplay this character accurately. Do not include generic app instructions. Return only the system prompt text.",
  post_history_instructions:
    "Write a short reminder inserted after chat history and before generation. Focus on in-character behavior, response style, or continuity. Return only the instruction text.",
  creator_notes:
    "Write complete private creator notes in a few simple sentences. Keep them practical: intended use, strengths, notable quirks, and any handling tips needed to use the card well. Do not write as the character. Do not stop mid-thought. Return only the creator notes.",
  tags: "Write 4-8 short organization tags. Return either a JSON array of strings or comma-separated tag names.",
  depth_prompt:
    'Write a depth prompt plus settings. Return JSON only: { "prompt": "persistent reminder text", "depth": 4, "role": "system" }. Depth should be 0-100. Role must be "system", "user", or "assistant".',
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(stripMarkdownFence(raw));
  } catch {
    return undefined;
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  return readRecord(parseJsonValue(raw));
}

function jsonFieldValue(field: CharacterFieldGenerationField, raw: string): unknown {
  const parsed = parseJsonRecord(raw);
  if (Object.keys(parsed).length === 0) return undefined;
  return parsed[field] ?? parsed[CHARACTER_FIELD_LABELS[field]] ?? parsed.value;
}

function stripFieldLabel(field: CharacterFieldGenerationField, value: string): string {
  const labels = [CHARACTER_FIELD_LABELS[field], field.replace(/_/g, " "), field];
  let result = value.trim();
  for (const label of labels) {
    const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i");
    result = result.replace(pattern, "").trim();
  }
  return result;
}

function cleanTextField(field: CharacterFieldGenerationField, raw: string): string {
  const jsonValue = jsonFieldValue(field, raw);
  const source = typeof jsonValue === "string" ? jsonValue : raw;
  return stripFieldLabel(field, stripWrappingQuotes(stripMarkdownFence(source))).trim();
}

function cleanGeneratedTagText(value: string): string {
  return stripWrappingQuotes(value.trim().replace(/^\[/, "").replace(/\]$/, "").trim())
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTagsFromStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = cleanGeneratedTagText(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function cleanTags(raw: string): string[] {
  const parsedValue = parseJsonValue(raw);
  const parsedRecord = readRecord(parsedValue);
  const jsonTags = readTextArray(
    Array.isArray(parsedValue) ? parsedValue : (parsedRecord.tags ?? parsedRecord.Tags ?? parsedRecord.value),
  );
  if (jsonTags.length > 0) return normalizeTagsFromStrings(jsonTags);
  return normalizeTagsFromStrings(
    stripMarkdownFence(raw)
      .split(/[\n,]/)
      .map((part) => stripFieldLabel("tags", part)),
  );
}

function normalizeDepth(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) return 4;
  return Math.max(0, Math.min(100, Math.trunc(numeric)));
}

function normalizeDepthRole(value: unknown): DepthPrompt["role"] {
  return value === "user" || value === "assistant" || value === "system" ? value : "system";
}

function cleanDepthPrompt(raw: string): DepthPrompt {
  const parsed = parseJsonRecord(raw);
  const prompt = readText(parsed.prompt) || cleanTextField("depth_prompt", raw);
  return {
    prompt,
    depth: normalizeDepth(parsed.depth),
    role: normalizeDepthRole(parsed.role),
  };
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

export function buildCharacterFieldGenerationMessages(
  field: CharacterFieldGenerationField,
  input: CharacterFieldGenerationInput,
): LlmMessage[] {
  const depthPrompt = readRecord(input.data.extensions.depth_prompt);
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
    labelledLine("System prompt", input.data.system_prompt),
    labelledLine("Post-history instructions", input.data.post_history_instructions),
    labelledLine("Creator notes", input.data.creator_notes),
    readTextArray(input.data.tags).length > 0 ? `Tags:\n${readTextArray(input.data.tags).join(", ")}` : "",
    readText(depthPrompt.prompt)
      ? `Depth prompt:\n${readText(depthPrompt.prompt)}\nDepth: ${normalizeDepth(depthPrompt.depth)}\nRole: ${normalizeDepthRole(depthPrompt.role)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "You are a creative character card editor for De-Koi.",
        "Generate exactly one requested character card field from the supplied card context.",
        "Preserve the established character voice, setting, and continuity.",
        "Do not explain your reasoning, offer alternatives, or add markdown unless the requested field format requires it.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Requested field: ${CHARACTER_FIELD_LABELS[field]}`,
        FIELD_INSTRUCTIONS[field],
        "",
        "Character context:",
        context || "No additional character context was provided.",
        "",
        "Return only the requested field.",
      ].join("\n"),
    },
  ];
}

export function cleanGeneratedCharacterField(
  field: CharacterFieldGenerationField,
  raw: string,
): CharacterFieldGenerationValue {
  if (field === "tags") return cleanTags(raw);
  if (field === "depth_prompt") return cleanDepthPrompt(raw);
  return cleanTextField(field, raw);
}

export async function generateCharacterField(
  input: GenerateCharacterFieldInput,
): Promise<CharacterFieldGenerationValue> {
  if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  const rawParts: string[] = [];
  const request = {
    connectionId: input.connectionId,
    messages: buildCharacterFieldGenerationMessages(input.field, input),
    parameters: {
      temperature: 0.9,
      maxTokens:
        input.field === "tags"
          ? 512
          : input.field === "creator_notes"
            ? 1536
            : input.field === "depth_prompt"
              ? 1024
              : 3072,
    },
  };

  for await (const chunk of input.llm.stream(request, input.signal)) {
    if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const text = chunkText(chunk);
    if (chunk.type === "error") throw new Error(text || `${CHARACTER_FIELD_LABELS[input.field]} generation failed`);
    if (chunk.type === "token" && text) rawParts.push(text);
  }

  const value = cleanGeneratedCharacterField(input.field, rawParts.join(""));
  if (Array.isArray(value) && value.length === 0) throw new Error("Provider returned no tags.");
  if (!Array.isArray(value) && typeof value !== "object" && !value.trim()) {
    throw new Error(`Provider returned no ${CHARACTER_FIELD_LABELS[input.field].toLowerCase()} text.`);
  }
  if (typeof value === "object" && !Array.isArray(value) && !value.prompt.trim()) {
    throw new Error("Provider returned no depth prompt text.");
  }
  return value;
}

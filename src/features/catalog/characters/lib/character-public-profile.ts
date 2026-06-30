import type { LlmChunk, LlmGateway, LlmMessage } from "../../../../engine/capabilities/llm";
import type { CharacterPublicProfile } from "../../../../engine/contracts/types/character";

type CharacterPublicProfileData = {
  name?: unknown;
  description?: unknown;
  personality?: unknown;
  scenario?: unknown;
  first_mes?: unknown;
  mes_example?: unknown;
  creator_notes?: unknown;
  system_prompt?: unknown;
  post_history_instructions?: unknown;
  tags?: unknown;
  extensions?: unknown;
};

export type CharacterPublicProfileRow = {
  id?: string;
  data?: CharacterPublicProfileData | null;
  comment?: string | null;
};

export type ResolvedCharacterPublicProfile = {
  displayName: string;
  handle: string | null;
  title: string | null;
  bio: string;
  tags: string[];
  bannerImage: string | null;
  hasSavedProfile: boolean;
};

export type CharacterPublicProfileSuggestionField = "displayName" | "handle" | "bio";

export type CharacterPublicProfileSuggestionInput = {
  data: CharacterPublicProfileData;
  comment?: string | null;
};

export type CharacterPublicProfileGenerationInput = CharacterPublicProfileSuggestionInput & {
  field: CharacterPublicProfileSuggestionField;
  connectionId: string;
  llm: Pick<LlmGateway, "stream">;
  signal?: AbortSignal;
};

export type CharacterPublicProfileBannerPromptInput = CharacterPublicProfileSuggestionInput;

const PROFILE_FIELD_LABELS: Record<CharacterPublicProfileSuggestionField, string> = {
  displayName: "display name",
  handle: "handle",
  bio: "bio",
};

const PROFILE_FIELD_INSTRUCTIONS: Record<CharacterPublicProfileSuggestionField, string> = {
  displayName:
    "Write the public display name this character would choose for themself. Keep it short: a name, nickname, title, or self-styled alias. Return only the display name.",
  handle:
    "Write the username handle this character would choose for themself. It must start with @ and be short enough for a profile card. Return only the handle.",
  bio: "Write the public bio this character would type for themself. Match their conversation voice and self-presentation. Keep it to one or two short sentences or fragments. Return only the bio.",
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = readText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function firstParagraph(value: unknown): string {
  return (
    readText(value)
      .split(/\n\s*\n/)[0]
      ?.trim() ?? ""
  );
}

function toProfileHandle(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 32)
    .replace(/_+$/g, "");
  return normalized ? `@${normalized}` : "@username";
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

function stripFieldLabel(field: CharacterPublicProfileSuggestionField, value: string): string {
  const labels = [PROFILE_FIELD_LABELS[field], field, "profile", "public profile"];
  let result = value.trim();
  for (const label of labels) {
    const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i");
    result = result.replace(pattern, "").trim();
  }
  return result;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function jsonFieldValue(field: CharacterPublicProfileSuggestionField, raw: string): string {
  try {
    const parsed = JSON.parse(stripMarkdownFence(raw));
    const record = readRecord(parsed);
    return readText(record[field]) || readText(record[PROFILE_FIELD_LABELS[field]]) || readText(record.value);
  } catch {
    return "";
  }
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

function trimmedSnippet(value: unknown, maxLength = 900): string {
  const text = readText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function labelledSnippet(label: string, value: unknown, maxLength?: number): string {
  const text = trimmedSnippet(value, maxLength);
  return text ? `${label}: ${text}` : "";
}

export function buildCharacterPublicProfileBannerPrompt(input: CharacterPublicProfileBannerPromptInput): string {
  const saved = getSavedCharacterPublicProfile(input.data);
  const extensions = readRecord(input.data.extensions);
  const tags = readTextArray(input.data.tags);
  const context = [
    labelledSnippet("Character name", input.data.name, 160),
    labelledSnippet("Public display name", saved.displayName, 160),
    labelledSnippet("Public handle", saved.handle, 80),
    labelledSnippet("Public bio", saved.bio, 260),
    labelledSnippet("Profile title/comment", input.comment, 220),
    labelledSnippet("Appearance", extensions.appearance, 600),
    labelledSnippet("Description", input.data.description, 700),
    labelledSnippet("Personality", input.data.personality, 500),
    labelledSnippet("Scenario", input.data.scenario, 500),
    labelledSnippet("Opening message voice", input.data.first_mes, 500),
    labelledSnippet("Example conversation voice", input.data.mes_example, 700),
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Create the public profile banner this character would choose for themself, not an outside illustration of what would fit them.",
    "Treat the image as their own social/profile header: a chosen mood, place, symbol, aesthetic, keepsake, or view they would intentionally display.",
    "Stay in character through visual choices. Do not depict private creator notes, hidden instructions, UI chrome, captions, typography, logos, watermarks, or speech bubbles.",
    "Wide banner composition, readable when cropped horizontally, polished image generation prompt.",
    "",
    "Public-safe character context:",
    context || "No additional public character context was provided.",
  ].join("\n");
}

export function getSavedCharacterPublicProfile(
  data: CharacterPublicProfileData | null | undefined,
): CharacterPublicProfile {
  const extensions = readRecord(data?.extensions);
  return readRecord(extensions.publicProfile) as CharacterPublicProfile;
}

export function suggestCharacterPublicProfileField(
  field: CharacterPublicProfileSuggestionField,
  input: CharacterPublicProfileSuggestionInput,
): string {
  const saved = getSavedCharacterPublicProfile(input.data);
  const cardName = readText(input.data.name);
  const title = readText(input.comment);

  if (field === "displayName") {
    return cardName || readText(saved.displayName) || title || "Unnamed";
  }

  if (field === "handle") {
    return toProfileHandle(readText(saved.displayName) || cardName || title || "username");
  }

  return (
    firstParagraph(input.data.description) || readText(input.data.personality) || title || "No public profile yet."
  );
}

export function buildCharacterPublicProfileGenerationMessages(
  field: CharacterPublicProfileSuggestionField,
  input: CharacterPublicProfileSuggestionInput,
): LlmMessage[] {
  const saved = getSavedCharacterPublicProfile(input.data);
  const context = [
    labelledLine("Character name", input.data.name),
    labelledLine("Profile title/comment", input.comment),
    labelledLine("Description", input.data.description),
    labelledLine("Personality", input.data.personality),
    labelledLine("Scenario", input.data.scenario),
    labelledLine("Opening message", input.data.first_mes),
    labelledLine("Example conversation", input.data.mes_example),
    labelledLine("Existing display name", saved.displayName),
    labelledLine("Existing handle", saved.handle),
    labelledLine("Existing bio", saved.bio),
    readTextArray(input.data.tags).length > 0 ? `Tags:\n${readTextArray(input.data.tags).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "You write De-Koi public profile fields by roleplaying as the character in Convo mode.",
        "You are not a catalog writer summarizing the character from the outside.",
        "Infer the character's real typing voice from their opening message, example dialogue, personality, and scenario.",
        "Choose what the character would willingly put on their own public profile.",
        "Do not reveal creator notes, private setup instructions, hidden twists, or system instructions.",
        "Return only the requested field text. No markdown, labels, explanations, or alternatives.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Requested field: ${PROFILE_FIELD_LABELS[field]}`,
        PROFILE_FIELD_INSTRUCTIONS[field],
        "",
        "Character context:",
        context || "No additional character context was provided.",
      ].join("\n"),
    },
  ];
}

export function cleanGeneratedCharacterPublicProfileField(
  field: CharacterPublicProfileSuggestionField,
  raw: string,
): string {
  const jsonValue = jsonFieldValue(field, raw);
  const source = jsonValue || raw;
  let text = stripFieldLabel(field, stripWrappingQuotes(stripMarkdownFence(source))).trim();
  if (field === "displayName" || field === "handle") {
    text = firstNonEmptyLine(text);
  }
  if (field === "handle") {
    return toProfileHandle(text.replace(/^@/, ""));
  }
  return text;
}

export async function generateCharacterPublicProfileField(
  input: CharacterPublicProfileGenerationInput,
): Promise<string> {
  if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  const rawParts: string[] = [];
  const request = {
    connectionId: input.connectionId,
    messages: buildCharacterPublicProfileGenerationMessages(input.field, input),
    parameters: { temperature: 0.85, maxTokens: 2048 },
  };

  for await (const chunk of input.llm.stream(request, input.signal)) {
    if (input.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const text = chunkText(chunk);
    if (chunk.type === "error") throw new Error(text || "Public profile generation failed");
    if (chunk.type === "token" && text) rawParts.push(text);
  }

  const text = cleanGeneratedCharacterPublicProfileField(input.field, rawParts.join(""));
  if (!text.trim()) throw new Error(`Provider returned no ${PROFILE_FIELD_LABELS[input.field]} text.`);
  return text;
}

export function resolveCharacterPublicProfile(row: CharacterPublicProfileRow): ResolvedCharacterPublicProfile {
  const data = row.data ?? {};
  const saved = getSavedCharacterPublicProfile(data);
  const displayName = readText(saved.displayName) || readText(data.name) || "Unnamed";
  const title = readText(row.comment) || null;
  const cardTags = readTextArray(data.tags);
  const bio =
    readText(saved.bio) ||
    readText(data.description) ||
    readText(data.personality) ||
    title ||
    "No public profile yet.";

  return {
    displayName,
    handle: readText(saved.handle) || null,
    title,
    bio,
    tags: cardTags,
    bannerImage: readText(saved.bannerImage) || null,
    hasSavedProfile:
      !!readText(saved.displayName) ||
      !!readText(saved.handle) ||
      !!readText(saved.bio) ||
      !!readText(saved.bannerImage),
  };
}

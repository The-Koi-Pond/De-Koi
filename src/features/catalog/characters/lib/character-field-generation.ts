import type { LlmChunk, LlmGateway, LlmMessage } from "../../../../engine/capabilities/llm";
import type {
  CharacterData,
  CharacterMusicFavoriteSong,
  DepthPrompt,
} from "../../../../engine/contracts/types/character";
import {
  parseFavoriteSongsText,
  parseMusicTextList,
  readCharacterMusicProfile,
  serializeFavoriteSongsText,
  serializeMusicTextList,
} from "./character-music-profile";

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
  | "music_favorite_songs"
  | "music_favorite_artists"
  | "music_favorite_genres"
  | "music_vibe_notes"
  | "depth_prompt";

export type CharacterFieldGenerationValue = string | string[] | CharacterMusicFavoriteSong[] | DepthPrompt;

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
  music_favorite_songs: "Favorite Music Songs",
  music_favorite_artists: "Favorite Music Artists",
  music_favorite_genres: "Favorite Music Genres",
  music_vibe_notes: "Vibe Notes",
  depth_prompt: "Depth Prompt",
};

const MUSIC_FIELD_INSTRUCTION =
  "For music taste, decide whether picks should be famous, niche, local, archival, online-only, or obscure from the character's background, era, access, subculture, and listening habits. Avoid defaulting to the same canonical moody/alternative picks unless the card context specifically points there.";

const CHARACTER_DETAIL_INSTRUCTION =
  "Prefer concrete behavioral tells, contradictions and limits, voice evidence from opening/example dialogue, and details that change how the character acts, notices, avoids, desires, or reacts. Avoid taxonomy-style trait lists, generic archetype labels, broad inventories of traits or features, and avoid generic AI-card wording families such as complex-and-multifaceted phrasing, speaks-with-a-mix-of formulas, and repeated signature-feature summaries.";

const FIELD_INSTRUCTIONS: Record<CharacterFieldGenerationField, string> = {
  description:
    "Write a rich character description in 2-4 compact paragraphs. Build from specific choices, frictions, habits, and social tells rather than a role summary. Return only the description text.",
  personality:
    "Write a concise personality field as playable pressures: habits under stress, social defaults, exceptions, contradictions, and what the character refuses to admit. Return only the personality text.",
  backstory:
    "Write the character's history, origin, and formative events in 2-3 compact paragraphs. Return only the backstory text.",
  appearance:
    "Write appearance as usable scene detail: what changes under light, motion, stress, weather, intimacy, work, or concealment. Include physical inventory only when it changes how others read or interact with the character. Return only the appearance text.",
  scenario:
    "Write the default setting or situation where interactions with this character begin. Return only the scenario text.",
  first_mes:
    "Write the character's opening message in their voice. Use *asterisks* for actions. Keep it to 1-3 paragraphs. Return only the first message.",
  mes_example:
    "Write 2-3 example dialogue exchanges. Use this format exactly: <START>\\n{{user}}: message\\n{{char}}: reply. Return only the example dialogue.",
  system_prompt:
    "Write character-specific system instructions that preserve this character's voice, boundaries, blind spots, recurring choices, and scene priorities. Do not include generic app instructions or broad trait summaries. Return only the system prompt text.",
  post_history_instructions:
    "Write a short reminder inserted after chat history and before generation. Focus on one or two concrete response habits, continuity pressures, or things the character should avoid repeating. Return only the instruction text.",
  creator_notes:
    "Write complete private creator notes in a few simple sentences. Keep them practical: intended use, strengths, notable quirks, and any handling tips needed to use the card well. Do not write as the character. Do not stop mid-thought. Return only the creator notes.",
  tags: "Write 4-8 short organization tags. Return either a JSON array of strings or comma-separated tag names.",
  music_favorite_songs: `Write 3-6 favorite songs this character would plausibly love or publicly list. ${MUSIC_FIELD_INSTRUCTION} Return JSON only: [{ "title": "Song title", "artist": "Artist name" }]. Include a "url" only if the source context already provided one; do not invent URLs.`,
  music_favorite_artists: `Write 3-8 favorite music artists this character would plausibly love or publicly list. ${MUSIC_FIELD_INSTRUCTION} Return JSON only: an array of artist name strings.`,
  music_favorite_genres: `Write 3-8 favorite music genres or microgenres that fit this character. ${MUSIC_FIELD_INSTRUCTION} Return JSON only: an array of genre strings.`,
  music_vibe_notes: `Write one short music-taste vibe note for fallback Music Player searches. Use mood, setting, sonic texture, or listening context. ${MUSIC_FIELD_INSTRUCTION} Return only the note text.`,
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

function isMusicField(field: CharacterFieldGenerationField): boolean {
  return (
    field === "music_favorite_songs" ||
    field === "music_favorite_artists" ||
    field === "music_favorite_genres" ||
    field === "music_vibe_notes"
  );
}

function replacementLine(
  activeField: CharacterFieldGenerationField,
  targetField: CharacterFieldGenerationField,
  label: string,
  value: unknown,
): string {
  const text = readText(value);
  if (!text) return "";
  if (activeField === targetField) return `Previous ${label.toLowerCase()} to replace:\n${text}`;
  return `${label}:\n${text}`;
}

function isPlayableDetailField(field: CharacterFieldGenerationField): boolean {
  return (
    field === "description" ||
    field === "personality" ||
    field === "appearance" ||
    field === "system_prompt" ||
    field === "post_history_instructions"
  );
}
function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
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

function parseLooseJsonArray(raw: string): unknown[] {
  const source = stripMarkdownFence(raw);
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  const repaired = source
    .slice(start, end + 1)
    .replace(/^\[\s*,+\s*/, "[")
    .replace(/,\s*\]$/, "]");
  const parsed = parseJsonValue(repaired);
  return Array.isArray(parsed) ? parsed : [];
}

function jsonArrayFieldValue(raw: string, keys: string[]): unknown[] {
  const parsedValue = parseJsonValue(raw);
  if (Array.isArray(parsedValue)) return parsedValue;
  const parsedRecord = readRecord(parsedValue);
  for (const key of keys) {
    const value = parsedRecord[key];
    if (Array.isArray(value)) return value;
  }
  return parseLooseJsonArray(raw);
}

function cleanMusicTextListField(field: CharacterFieldGenerationField, raw: string, keys: string[]): string[] {
  const jsonValues = jsonArrayFieldValue(raw, [...keys, field, CHARACTER_FIELD_LABELS[field], "value"])
    .map((item) => readText(item))
    .filter(Boolean);
  if (jsonValues.length > 0) return parseMusicTextList(jsonValues.join("\n"));
  return parseMusicTextList(stripFieldLabel(field, stripMarkdownFence(raw)));
}

function cleanMusicFavoriteSongs(raw: string): CharacterMusicFavoriteSong[] {
  const jsonValues = jsonArrayFieldValue(raw, [
    "favoriteSongs",
    "songs",
    "music_favorite_songs",
    "Favorite Music Songs",
    "value",
  ]);
  if (jsonValues.length > 0) {
    return parseFavoriteSongsText(
      jsonValues
        .map((item) => {
          const record = readRecord(item);
          const title = readText(record.title);
          if (!title) return "";
          const artist = readText(record.artist);
          const url = readText(record.url);
          return `${title}${artist ? ` - ${artist}` : ""}${url ? ` | ${url}` : ""}`;
        })
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parseFavoriteSongsText(stripFieldLabel("music_favorite_songs", stripMarkdownFence(raw)));
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
  const musicProfile = readCharacterMusicProfile(input.data.extensions.musicProfile);
  const favoriteSongs = musicProfile.favoriteSongs ?? [];
  const favoriteArtists = musicProfile.favoriteArtists ?? [];
  const favoriteGenres = musicProfile.favoriteGenres ?? [];
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
    favoriteSongs.length > 0
      ? replacementLine(field, "music_favorite_songs", "Favorite songs", serializeFavoriteSongsText(favoriteSongs))
      : "",
    favoriteArtists.length > 0
      ? replacementLine(field, "music_favorite_artists", "Favorite artists", serializeMusicTextList(favoriteArtists))
      : "",
    favoriteGenres.length > 0
      ? replacementLine(field, "music_favorite_genres", "Favorite genres", serializeMusicTextList(favoriteGenres))
      : "",
    replacementLine(field, "music_vibe_notes", "Music vibe notes", musicProfile.vibeNotes),
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
        "Favor concrete, idiosyncratic details from the supplied card over stock tropes, generic genre shorthand, or cliche personality copy.",
        "Do not explain your reasoning, offer alternatives, or add markdown unless the requested field format requires it.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Requested field: ${CHARACTER_FIELD_LABELS[field]}`,
        FIELD_INSTRUCTIONS[field],
        isMusicField(field)
          ? "When previous values are listed for the requested music field, use them only as an avoid-list. Generate substantially different picks instead of copying, reordering, or swapping in near-neighbor defaults."
          : "",
        isPlayableDetailField(field) ? CHARACTER_DETAIL_INSTRUCTION : "",
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
  if (field === "music_favorite_songs") return cleanMusicFavoriteSongs(raw);
  if (field === "music_favorite_artists") return cleanMusicTextListField(field, raw, ["favoriteArtists", "artists"]);
  if (field === "music_favorite_genres") return cleanMusicTextListField(field, raw, ["favoriteGenres", "genres"]);
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
        input.field === "tags" ||
        input.field === "music_favorite_songs" ||
        input.field === "music_favorite_artists" ||
        input.field === "music_favorite_genres" ||
        input.field === "music_vibe_notes"
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
  if (Array.isArray(value) && value.length === 0) {
    throw new Error(`Provider returned no ${CHARACTER_FIELD_LABELS[input.field].toLowerCase()}.`);
  }
  if (!Array.isArray(value) && typeof value !== "object" && !value.trim()) {
    throw new Error(`Provider returned no ${CHARACTER_FIELD_LABELS[input.field].toLowerCase()} text.`);
  }
  if (typeof value === "object" && !Array.isArray(value) && !value.prompt.trim()) {
    throw new Error("Provider returned no depth prompt text.");
  }
  return value;
}

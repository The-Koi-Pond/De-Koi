import type { CharacterPublicProfile } from "../../../../engine/contracts/types/character";

export type ConnectionRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
};

export type GeneratedCharacterData = {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  backstory?: string;
  appearance?: string;
  publicProfile?: unknown;
};

export function parseTagsInput(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function mergeTags(generatedTags: string[] | undefined, referenceTags: string[]): string[] {
  const seen = new Set<string>();
  return [...(generatedTags ?? []), ...referenceTags]
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstParagraph(value: unknown): string {
  return (
    readText(value)
      .split(/\n\s*\n/)[0]
      ?.trim() ?? ""
  );
}

export function buildGeneratedCharacterPublicProfile(
  generated: GeneratedCharacterData,
  finalName: string,
): CharacterPublicProfile {
  const explicit = readRecord(generated.publicProfile);
  const profile: CharacterPublicProfile = {};
  const displayName = readText(explicit.displayName) || readText(explicit.name) || finalName.trim();
  const handle = readText(explicit.handle);
  const bio = readText(explicit.bio) || firstParagraph(generated.description) || readText(generated.personality);
  const bannerImage = readText(explicit.bannerImage);

  if (displayName) profile.displayName = displayName;
  if (handle) profile.handle = handle;
  if (bio) profile.bio = bio;
  if (bannerImage) profile.bannerImage = bannerImage;
  return profile;
}
export function nameKeywords(name: string): string[] {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set([name.trim(), ...parts])).filter(Boolean);
}

export function characterLorebookContent(data: GeneratedCharacterData, name: string): string {
  return [
    `Name: ${name}`,
    data.description ? `Description: ${data.description}` : "",
    data.personality ? `Personality: ${data.personality}` : "",
    data.backstory ? `Backstory: ${data.backstory}` : "",
    data.appearance ? `Appearance: ${data.appearance}` : "",
    data.scenario ? `Scenario: ${data.scenario}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

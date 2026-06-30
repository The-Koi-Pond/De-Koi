import type { CharacterPublicProfile } from "../../../../engine/contracts/types/character";

type CharacterPublicProfileData = {
  name?: unknown;
  description?: unknown;
  creator_notes?: unknown;
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

export type CharacterPublicProfileSuggestionField = "displayName" | "handle";

export type CharacterPublicProfileSuggestionInput = {
  data: CharacterPublicProfileData;
  comment?: string | null;
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

  return toProfileHandle(readText(saved.displayName) || cardName || title || "username");
}

export function resolveCharacterPublicProfile(row: CharacterPublicProfileRow): ResolvedCharacterPublicProfile {
  const data = row.data ?? {};
  const saved = getSavedCharacterPublicProfile(data);
  const displayName = readText(saved.displayName) || readText(data.name) || "Unnamed";
  const title = readText(row.comment) || null;
  const savedTags = readTextArray(saved.tags);
  const cardTags = readTextArray(data.tags);
  const bio = readText(saved.bio) || title || "No public profile yet.";

  return {
    displayName,
    handle: readText(saved.handle) || null,
    title,
    bio,
    tags: savedTags.length > 0 ? savedTags : cardTags,
    bannerImage: readText(saved.bannerImage) || null,
    hasSavedProfile:
      !!readText(saved.displayName) ||
      !!readText(saved.handle) ||
      !!readText(saved.bio) ||
      savedTags.length > 0 ||
      !!readText(saved.bannerImage),
  };
}

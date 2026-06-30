import type { CharacterPublicProfile } from "../../../../engine/contracts/types/character";

type CharacterPublicProfileData = Record<string, unknown> & {
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

export function getSavedCharacterPublicProfile(
  data: CharacterPublicProfileData | null | undefined,
): CharacterPublicProfile {
  const extensions = readRecord(data?.extensions);
  return readRecord(extensions.publicProfile) as CharacterPublicProfile;
}

export function resolveCharacterPublicProfile(row: CharacterPublicProfileRow): ResolvedCharacterPublicProfile {
  const data = row.data ?? {};
  const saved = getSavedCharacterPublicProfile(data);
  const displayName = readText(saved.displayName) || readText(data.name) || "Unnamed";
  const title = readText(row.comment) || null;
  const cardTags = readTextArray(data.tags);
  const bio = readText(saved.bio) || title || "No public profile yet.";

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

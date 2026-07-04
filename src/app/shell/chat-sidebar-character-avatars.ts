import { avatarFileUrlFromPath } from "../../shared/api/local-file-api";
import type { AvatarCropValue } from "../../shared/lib/utils";

export type ChatSidebarCharacterAvatarSummary = {
  id: string;
  data?: {
    name?: string;
    extensions?: Record<string, unknown>;
  };
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
};

export type ChatSidebarCharacterAvatar = {
  name: string;
  avatarUrl: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  hasAvatarSource: boolean;
  avatarCrop?: AvatarCropValue | null;
  conversationStatus?: string;
};

function hasText(value: string | null | undefined): boolean {
  return !!value?.trim();
}

function readExtensions(character: ChatSidebarCharacterAvatarSummary): Record<string, unknown> {
  const extensions = character.data?.extensions;
  return extensions && typeof extensions === "object" && !Array.isArray(extensions) ? extensions : {};
}

export function buildChatSidebarCharacterLookup(
  characters: ChatSidebarCharacterAvatarSummary[] | null | undefined,
): Map<string, ChatSidebarCharacterAvatar> {
  const map = new Map<string, ChatSidebarCharacterAvatar>();
  for (const character of characters ?? []) {
    const extensions = readExtensions(character);
    const name =
      typeof character.data?.name === "string" && character.data.name.trim() ? character.data.name.trim() : "Unknown";
    const avatarUrl =
      avatarFileUrlFromPath(character.avatarFilename, character.avatarFilePath) ?? character.avatarPath ?? null;
    const conversationStatus =
      typeof extensions.conversationStatus === "string" ? extensions.conversationStatus : undefined;

    map.set(character.id, {
      name,
      avatarUrl,
      avatarFilePath: character.avatarFilePath,
      avatarFilename: character.avatarFilename,
      hasAvatarSource: hasText(avatarUrl) || hasText(character.avatarFilePath) || hasText(character.avatarFilename),
      avatarCrop: (extensions.avatarCrop as AvatarCropValue | undefined) ?? null,
      conversationStatus,
    });
  }
  return map;
}

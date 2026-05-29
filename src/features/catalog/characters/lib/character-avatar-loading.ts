export type CharacterAvatarLoadingMode = "eager" | "lazy";

export function getCharacterAvatarLoadingMode(src: string | null | undefined): CharacterAvatarLoadingMode {
  if (!src) return "lazy";
  const value = src.trim().toLowerCase();
  return value.startsWith("data:") || value.startsWith("blob:") ? "eager" : "lazy";
}

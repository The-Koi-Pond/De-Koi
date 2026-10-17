import type { PresentCharacter } from "../../../../engine/contracts/types/tracker-state";
import { visibleText } from "./tracker-display.helpers";

export function getCharacterPortraitFallback(character: PresentCharacter) {
  const emoji = character.emoji?.trim();
  if (emoji && emoji !== "?") return emoji;
  const initial = visibleText(character.name, "C").slice(0, 1).toUpperCase();
  return initial === "?" ? "C" : initial;
}

export function getCharacterFeatureKey(character: PresentCharacter, index: number) {
  const trimmedId = character.characterId?.trim();
  if (trimmedId) return trimmedId;

  const trimmedName = character.name?.trim();
  if (trimmedName) return `${trimmedName}-${index}`;

  return `character-${index}`;
}

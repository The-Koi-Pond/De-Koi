import type { LorebookCategory } from "../../../../engine/contracts/types/lorebook";

export const LOREBOOK_CATEGORY_OPTIONS: Array<{ value: LorebookCategory; label: string }> = [
  { value: "world", label: "World" },
  { value: "character", label: "Character" },
  { value: "npc", label: "NPC" },
  { value: "spellbook", label: "Spellbook" },
  { value: "game", label: "Game" },
  { value: "uncategorized", label: "Uncategorized" },
];

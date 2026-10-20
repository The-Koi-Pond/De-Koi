import { toast } from "sonner";

import { useUIStore } from "../../../../shared/stores/ui.store";

export type CardLintTarget = {
  characterId: string;
  name: string;
  data: Record<string, unknown>;
};

/** The saved character an import returned, in the shape the card check needs. */
export function cardLintTarget(character: unknown, characterId?: string | null): CardLintTarget | null {
  if (!character || typeof character !== "object") return null;
  const record = character as { id?: unknown; data?: unknown };
  const id = characterId || (typeof record.id === "string" ? record.id : "");
  const data = record.data;
  if (!id || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const name = (data as { name?: unknown }).name;
  return {
    characterId: id,
    name: typeof name === "string" && name ? name : "Imported character",
    data: data as Record<string, unknown>,
  };
}

/**
 * For imports that only toast: if the card has problems, offer the card check from the toast.
 * The linter loads on demand so it stays out of the first-screen bundle.
 */
export async function offerCardLintReview(result: { character?: unknown; characterId?: string | null }): Promise<void> {
  const target = cardLintTarget(result.character, result.characterId);
  if (!target) return;
  const { lintCharacterCard } = await import("../../../../engine/entities/character-card-lint");
  const count = lintCharacterCard(target.data).length;
  if (count === 0) return;
  toast.warning(`${target.name}: ${count} thing${count === 1 ? "" : "s"} in this card may trip up the model.`, {
    duration: 15_000,
    action: { label: "Review", onClick: () => useUIStore.getState().openModal("card-lint", target) },
  });
}

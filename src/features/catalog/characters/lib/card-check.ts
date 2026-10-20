import { storageApi } from "../../../../shared/api/storage-api";
import { cardLintTarget, type CardLintTarget } from "./card-lint-target";

/** The card fields the linter reads, so the check skips avatars, books and extensions. */
const LINTED_DATA_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "alternate_greetings",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
  "creator_notes",
];

export type CardCheckResult = {
  /** How many saved cards were checked. */
  checked: number;
  /** The checked cards with at least one finding, in library order. */
  flagged: CardLintTarget[];
};

/**
 * Runs the card check on saved characters: all of them, or only `characterIds`.
 * The linter loads on demand so it stays out of the first-screen bundle.
 */
export async function runCardCheck(characterIds?: string[]): Promise<CardCheckResult> {
  if (characterIds && characterIds.length === 0) return { checked: 0, flagged: [] };
  const [{ lintCharacterCard }, rows] = await Promise.all([
    import("../../../../engine/entities/character-card-lint"),
    storageApi.list<unknown>("characters", {
      fields: ["id", "data"],
      fieldSelections: { data: LINTED_DATA_FIELDS },
      ...(characterIds ? { whereIn: { field: "id", values: characterIds } } : {}),
    }),
  ]);
  const targets = rows.map((row) => cardLintTarget(row)).filter((target) => target !== null);
  return {
    checked: targets.length,
    flagged: targets.filter((target) => lintCharacterCard(target.data).length > 0),
  };
}

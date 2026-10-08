import {
  EDITABLE_CHARACTER_CARD_FIELDS,
  type AgentResult,
  type CharacterCardFieldUpdate,
  type EditableCharacterCardField,
} from "../contracts/types/agent";
import { isRecord, parseRecord, readString } from "./runtime-records";

/**
 * Where a stored Card Evolution proposal (`resultData.updates[i].reviewStatus`) stands. Only runs
 * recovered after their tab closed store one; a live turn's proposals go straight to the review
 * dialog in that tab and are not offered again.
 */
export type CardEvolutionReviewStatus = "pending" | "applying" | "applied" | "rejected";

const REVIEW_STATUSES = new Set<string>(["pending", "applying", "applied", "rejected"]);
const EDITABLE_FIELDS = new Set<string>(EDITABLE_CHARACTER_CARD_FIELDS);

export function isCardEvolutionResult(result: { agentType?: unknown; type?: unknown }): boolean {
  return result.agentType === "card-evolution-auditor" || result.type === "character_card_update";
}

export function cardEvolutionRawUpdates(data: unknown): unknown[] {
  const updates = parseRecord(data).updates;
  return Array.isArray(updates) ? updates : [];
}

export function cardEvolutionReviewStatus(update: unknown): CardEvolutionReviewStatus | null {
  const status = readString(parseRecord(update).reviewStatus).trim();
  return REVIEW_STATUSES.has(status) ? (status as CardEvolutionReviewStatus) : null;
}

export function parseCharacterCardFieldUpdate(raw: unknown): CharacterCardFieldUpdate | null {
  if (!isRecord(raw)) return null;
  if (raw.action !== "update") return null;
  const characterId = readString(raw.characterId).trim();
  const field = readString(raw.field);
  const oldText = readString(raw.oldText);
  const newText = readString(raw.newText);
  if (!characterId || !EDITABLE_FIELDS.has(field) || oldText === newText) return null;
  return {
    characterId,
    action: "update",
    field: field as EditableCharacterCardField,
    oldText,
    newText,
    reason: readString(raw.reason),
  };
}

/**
 * Stores a recovered run's Card Evolution proposals as `pending`, so the review dialog offers them
 * from storage in whichever tab opens the chat. Resolves with the results and how many are pending.
 */
export function markCardEvolutionProposalsPending(results: AgentResult[]): { results: AgentResult[]; pending: number } {
  let pending = 0;
  const marked = results.map((result) => {
    if (!result.success || !isCardEvolutionResult(result)) return result;
    const updates = cardEvolutionRawUpdates(result.data);
    if (!updates.some((update) => parseCharacterCardFieldUpdate(update))) return result;
    return {
      ...result,
      data: {
        ...parseRecord(result.data),
        updates: updates.map((update) => {
          if (!parseCharacterCardFieldUpdate(update)) return update;
          pending += 1;
          return { ...parseRecord(update), reviewStatus: "pending" };
        }),
      },
    };
  });
  return { results: marked, pending };
}

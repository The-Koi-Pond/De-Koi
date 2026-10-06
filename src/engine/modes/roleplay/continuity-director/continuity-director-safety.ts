import { CONTINUITY_DIRECTOR_LIMITS } from "./continuity-director-state";

export interface ContinuityDirectorBeatSafetyInput {
  personaNames: string[];
}

export interface ContinuityDirectorBeatSafetyResult {
  safe: boolean;
  reasons: string[];
}

export interface ContinuityDirectorTextSafetyInput extends ContinuityDirectorBeatSafetyInput {
  maxCharacters?: number;
}

const DELIBERATE_ACTIONS =
  "say|says|tell|tells|ask|asks|answer|answers|draw|draws|attack|attacks|betray|betrays|leave|leaves|go|goes|choose|chooses|decide|decides|agree|agrees|refuse|refuses|lie|lies|confess|confesses|promise|promises|plan|plans|intend|intends|want|wants|believe|believes|think|thinks";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateContinuityDirectorText(
  raw: string,
  input: ContinuityDirectorTextSafetyInput,
): ContinuityDirectorBeatSafetyResult {
  const text = raw.trim();
  const reasons: string[] = [];
  if (!text) reasons.push("empty");
  if (text.length > (input.maxCharacters ?? CONTINUITY_DIRECTOR_LIMITS.itemCharacters)) reasons.push("too_long");

  const deliberate = new RegExp(`\\b(?:you|your character|i)\\b[^.!?]{0,50}\\b(?:${DELIBERATE_ACTIONS})\\b`, "i");
  if (deliberate.test(text)) reasons.push("user_agency");

  for (const rawName of input.personaNames) {
    const name = rawName.trim();
    if (!name) continue;
    const escaped = escapeRegex(name);
    const speakerLabel = new RegExp(`(?:^|[.!?]\\s+)${escaped}\\s*:`, "i");
    const personaAction = new RegExp(`\\b${escaped}(?:'s)?\\b[^.!?]{0,45}\\b(${DELIBERATE_ACTIONS})\\b`, "gi");
    // Every mention is checked, so one exempt phrasing cannot hide a later violation.
    const decidesForPersona = [...text.matchAll(personaAction)].some((actionMatch) => {
      const leavesChoiceOpen =
        /^(?:choose|chooses|decide|decides)$/i.test(actionMatch[1] ?? "") &&
        /^\s+(?:how|whether|what)\b/i.test(text.slice(actionMatch.index + actionMatch[0].length));
      // "what Chai wants", "whether Chai agrees", "if Chai refuses": an open question or condition
      // about the persona, not a statement that decides for them. "What Chai wants is revenge"
      // answers the question, so it does not count.
      const asksAboutPersona =
        /\b(?:what|whether|how|if|which|why)\s+$/i.test(text.slice(0, actionMatch.index)) &&
        !/^\s+(?:is|was|are|were)\b/i.test(text.slice(actionMatch.index + actionMatch[0].length));
      return !leavesChoiceOpen && !asksAboutPersona;
    });
    if (speakerLabel.test(text) || decidesForPersona) {
      reasons.push("persona_agency");
      break;
    }
  }

  return { safe: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function validateContinuityDirectorBeat(
  raw: string,
  input: ContinuityDirectorBeatSafetyInput,
): ContinuityDirectorBeatSafetyResult {
  return validateContinuityDirectorText(raw, input);
}

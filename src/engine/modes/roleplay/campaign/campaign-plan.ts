// Checks a drafted plan against the campaign's rules, cleans the ids a model wrote, and merges a replan.
import type {
  CampaignClue,
  CampaignPlan,
  CampaignProgress,
  CampaignRequest,
  CampaignSituation,
  RoleplayCampaignState,
} from "../../../contracts/types/roleplay-campaign";
import type { CampaignBible, CampaignReplan, CampaignSituations } from "./campaign-schemas";
import { playedSituationIds } from "./campaign-state";

const CLUES_PER_TRUTH = 3;

/**
 * What the drafted situations get wrong, in words a reviewing model can act on. Empty when the plan holds up.
 */
export function planProblems(request: CampaignRequest, bible: CampaignBible, draft: CampaignSituations): string[] {
  const problems: string[] = [];
  const castIds = new Set(bible.cast.map((member) => member.id));
  const truthIds = new Set(bible.keyTruths.map((truth) => truth.id));
  const situationIds = new Set(draft.situations.map((situation) => situation.id));
  const clueById = new Map(draft.clues.map((clue) => [clue.id, clue]));

  if (situationIds.size !== draft.situations.length) problems.push("Two situations share an id.");
  for (const situation of draft.situations) {
    if (situation.exits.length < 2) problems.push(`"${situation.title}" has only one exit; give it at least two.`);
    if (situation.pressure.length < 2) problems.push(`"${situation.title}" needs a pressure clock of 2-4 steps.`);
    for (const id of situation.present) {
      if (!castIds.has(id)) problems.push(`"${situation.title}" lists "${id}" as present, who is not in the cast.`);
    }
    for (const id of situation.clueIds) {
      if (!clueById.has(id)) problems.push(`"${situation.title}" names clue "${id}", which does not exist.`);
    }
    for (const exit of situation.exits) {
      if (exit.leadsTo && !situationIds.has(exit.leadsTo)) {
        problems.push(`An exit of "${situation.title}" leads to "${exit.leadsTo}", which does not exist.`);
      }
      if (exit.leadsTo === situation.id) problems.push(`An exit of "${situation.title}" leads back to itself.`);
    }
  }
  for (const clue of draft.clues) {
    if (!truthIds.has(clue.truthId))
      problems.push(`Clue "${clue.id}" points to truth "${clue.truthId}", which does not exist.`);
  }
  for (const truth of bible.keyTruths) {
    const places = new Set(
      draft.situations
        .filter((situation) => situation.clueIds.some((id) => clueById.get(id)?.truthId === truth.id))
        .map((situation) => situation.id),
    );
    if (places.size < CLUES_PER_TRUTH) {
      problems.push(
        `Truth "${truth.id}" has clues in ${places.size} situation(s); it needs clues in at least ${CLUES_PER_TRUTH}.`,
      );
    }
  }
  const characterFocus = request.focus === "character" || request.secondaryFocus === "character";
  if (characterFocus) {
    const laddered = bible.cast.filter((member) => member.ladder.length > 0);
    if (laddered.length === 0) problems.push("This is a character campaign but no cast member has a closeness ladder.");
    for (const member of laddered) {
      const scenes = draft.situations.filter((situation) => situation.present.includes(member.id)).length;
      if (scenes < member.ladder.length) {
        problems.push(
          `${member.name} has ${member.ladder.length} closeness stages but is present in only ${scenes} situation(s).`,
        );
      }
    }
  }
  const firstPresent = draft.situations[0]?.present.length ?? 0;
  if (characterFocus && firstPresent === 0) problems.push("The first situation has nobody in it to be close to.");
  return problems;
}

/** Drops references the plan can't resolve, so a stored plan never names something that isn't there. */
function cleanSituations(
  situations: readonly CampaignSituation[],
  castIds: ReadonlySet<string>,
  clueIds: ReadonlySet<string>,
  allSituationIds: ReadonlySet<string>,
): CampaignSituation[] {
  return situations.map((situation) => ({
    ...situation,
    present: situation.present.filter((id) => castIds.has(id)),
    clueIds: situation.clueIds.filter((id) => clueIds.has(id)),
    exits: situation.exits.map((exit) => ({
      ...exit,
      leadsTo: exit.leadsTo && exit.leadsTo !== situation.id && allSituationIds.has(exit.leadsTo) ? exit.leadsTo : null,
    })),
  }));
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/** The plan to store: the bible plus the reviewed situations, with every dangling reference removed. */
export function assemblePlan(bible: CampaignBible, draft: CampaignSituations): CampaignPlan {
  const truthIds = new Set(bible.keyTruths.map((truth) => truth.id));
  const cast = uniqueById(bible.cast);
  const clues = uniqueById(draft.clues).filter((clue) => truthIds.has(clue.truthId));
  const situations = uniqueById(draft.situations);
  return {
    title: bible.title,
    pitch: bible.pitch,
    truth: bible.truth,
    keyTruths: uniqueById(bible.keyTruths),
    tableRules: bible.tableRules,
    cast,
    clues,
    endings: uniqueById(bible.endings),
    situations: cleanSituations(
      situations,
      new Set(cast.map((member) => member.id)),
      new Set(clues.map((clue) => clue.id)),
      new Set(situations.map((situation) => situation.id)),
    ),
    revision: 0,
  };
}

/**
 * The plan after a replan: played situations and the one in play stay exactly as they were, the unplayed rest is
 * replaced, new clues are added (an id already taken is kept as it was), and the endings are replaced.
 */
export function mergeReplan(
  state: RoleplayCampaignState,
  progress: CampaignProgress,
  replan: CampaignReplan,
): CampaignPlan {
  const played = playedSituationIds(progress);
  const kept = state.plan.situations.filter((situation) => played.has(situation.id));
  const fresh = uniqueById(replan.situations).filter((situation) => !played.has(situation.id));
  const takenClues = new Set(state.plan.clues.map((clue) => clue.id));
  const truthIds = new Set(state.plan.keyTruths.map((truth) => truth.id));
  const clues: CampaignClue[] = [
    ...state.plan.clues,
    ...uniqueById(replan.clues).filter((clue) => !takenClues.has(clue.id) && truthIds.has(clue.truthId)),
  ];
  const situations = [...kept, ...fresh];
  return {
    ...state.plan,
    clues,
    endings: uniqueById(replan.endings),
    situations: cleanSituations(
      situations,
      new Set(state.plan.cast.map((member) => member.id)),
      new Set(clues.map((clue) => clue.id)),
      new Set(situations.map((situation) => situation.id)),
    ),
    revision: state.plan.revision + 1,
  };
}

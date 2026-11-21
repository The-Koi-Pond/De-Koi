// The campaign's stored state and the pure rules that move it. Nothing here calls a model or storage.
import type {
  CampaignPacing,
  CampaignProgress,
  CampaignSituation,
  RoleplayCampaignState,
} from "../../../contracts/types/roleplay-campaign";
import { boolish, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { storedCampaignSchema, type CampaignTick } from "./campaign-schemas";

export const CAMPAIGN_METADATA_KEY = "roleplayCampaign";
export const START_KEY = "start";

/** Snapshots kept besides `start`: enough to roll back a few regenerations, edits or deletes. */
const KEPT_SNAPSHOTS = 8;
const MAX_FACTS = 20;
const MAX_DEBTS = 8;
/** Replies a situation may sit still before the pressure is brought in regardless. */
const PATIENCE = { short: 2, medium: 3, long: 5 } as const;
/**
 * Replies after which an unsettled situation is left behind (the moment passes, and the plan moves on) unless the
 * player is plainly enjoying it there.
 */
const LINGER_LIMIT = { short: 5, medium: 7, long: 10 } as const;
/** User turns this short count as passive; three in a row and the story stops waiting. */
const PASSIVE_USER_CHARS = 60;
const PASSIVE_TURNS = 3;
/** Fewest replies between two replans. */
const REPLAN_GAP = 6;

/** The chat's campaign, or null when it has none or what is stored is not a campaign this version can read. */
export function readCampaign(metadata: unknown): RoleplayCampaignState | null {
  const raw = parseRecord(metadata)[CAMPAIGN_METADATA_KEY];
  if (raw === undefined || raw === null) return null;
  const parsed = storedCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[campaign] stored campaign could not be read", parsed.error.issues.slice(0, 3));
    return null;
  }
  const state = parsed.data as RoleplayCampaignState;
  return state.progress[0]?.key === START_KEY ? state : null;
}

/** A short stable hash (FNV-1a, 32-bit) of a reply's text. */
function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Identifies one version of one reply: a swipe or an edit gets a new key, so its snapshot no longer matches. */
export function replyKey(message: JsonRecord): string {
  return `${readString(message.id).trim()}#${hashText(readString(message.content))}`;
}

function hidden(message: JsonRecord): boolean {
  return boolish(message.hiddenFromAI, false) || boolish(parseRecord(message.extra).hiddenFromAI, false);
}

/** Visible user and assistant messages, oldest first. */
export function visibleTurns(messages: readonly JsonRecord[]): JsonRecord[] {
  return messages.filter((message) => {
    const role = readString(message.role).trim();
    return (role === "user" || role === "assistant") && !hidden(message) && readString(message.content).trim();
  });
}

/**
 * The snapshot that describes the chat as it stands: the newest one whose reply is still in `messages` exactly as it
 * was processed. A regenerated, edited or deleted reply no longer matches, so the campaign falls back to the point
 * before it. `start` always matches.
 */
export function currentProgress(state: RoleplayCampaignState, messages: readonly JsonRecord[]): CampaignProgress {
  const keys = new Set(
    visibleTurns(messages)
      .filter((message) => message.role === "assistant")
      .map(replyKey),
  );
  for (let index = state.progress.length - 1; index > 0; index -= 1) {
    const snapshot = state.progress[index]!;
    if (keys.has(snapshot.key)) return snapshot;
  }
  return state.progress[0]!;
}

/**
 * The assistant replies the runner has not read yet, with the user turns between them, or empty when the newest
 * reply is already processed. The opening message counts as read: the plan wrote it.
 */
export function unreadExchange(
  state: RoleplayCampaignState,
  messages: readonly JsonRecord[],
): { from: CampaignProgress; turns: JsonRecord[] } {
  const turns = visibleTurns(messages);
  const from = currentProgress(state, messages);
  const lastAssistant = [...turns].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant || replyKey(lastAssistant) === from.key) return { from, turns: [] };
  const startIndex =
    from.key === START_KEY
      ? turns.findIndex((message) => message.role === "assistant") + 1
      : turns.findIndex((message) => message.role === "assistant" && replyKey(message) === from.key) + 1;
  const unread = turns.slice(Math.max(0, startIndex));
  // Only the opening exists (no user turn yet): nothing to read.
  return { from, turns: unread.some((message) => message.role === "user") ? unread : [] };
}

export function situationById(state: RoleplayCampaignState, id: string): CampaignSituation | null {
  return state.plan.situations.find((situation) => situation.id === id) ?? null;
}

/** The situation that comes after `situation` when an exit names none: the next unplayed one in order. */
function nextSituationId(
  state: RoleplayCampaignState,
  situation: CampaignSituation,
  played: Set<string>,
): string | null {
  const ordered = state.plan.situations;
  const index = ordered.findIndex((candidate) => candidate.id === situation.id);
  const after = ordered.slice(index + 1).find((candidate) => !played.has(candidate.id));
  return after?.id ?? null;
}

function newDebtId(progress: CampaignProgress, index: number): string {
  return `debt-${progress.turn + 1}-${index + 1}`;
}

export interface TickContext {
  /** The new reply's key. */
  key: string;
  /** Character counts of the user turns in the read exchange and before it, newest last. */
  recentUserLengths: number[];
  now: string;
}

/**
 * Applies the runner's read of one exchange and returns the next snapshot. The model proposes; these rules keep the
 * story moving and the state honest: unknown ids are dropped, a clock that runs out resolves the situation, a
 * situation that sits still too long brings its pressure in, and a passive player never stalls the story.
 */
export function applyTick(
  state: RoleplayCampaignState,
  from: CampaignProgress,
  tick: CampaignTick,
  context: TickContext,
) {
  const situation = situationById(state, from.situationId) ?? state.plan.situations[0]!;
  const castIds = new Set(state.plan.cast.map((member) => member.id));
  const clueIds = new Set(state.plan.clues.map((clue) => clue.id));
  const endingIds = new Set(state.plan.endings.map((ending) => ending.id));

  const revealed = [...new Set([...from.revealedClueIds, ...tick.revealedClueIds.filter((id) => clueIds.has(id))])];
  const facts = [...from.facts, ...tick.newFacts].slice(-MAX_FACTS);
  const paid = new Set(tick.debtsPaidIds);
  const debts = [
    ...from.debts.filter((debt) => !paid.has(debt.id)),
    ...tick.debtsCreated.map((debt, index) => ({ id: newDebtId(from, index), text: debt.text, due: debt.due })),
  ].slice(-MAX_DEBTS);
  const stances = { ...from.stances };
  for (const stance of tick.stances) if (castIds.has(stance.castId)) stances[stance.castId] = stance.text;
  const ladder = { ...from.ladder };
  for (const step of tick.ladder) {
    const member = state.plan.cast.find((candidate) => candidate.id === step.castId);
    if (!member || member.ladder.length === 0) continue;
    // Closeness moves one stage at a time, either way.
    const current = ladder[member.id] ?? 0;
    const target = Math.min(member.ladder.length - 1, Math.max(0, step.stage));
    ladder[member.id] = current + Math.sign(target - current);
  }

  let clock = from.clock + (tick.clockAdvanced ? 1 : 0);
  let status = tick.situation;
  let outcomeText = tick.outcome;
  // The clock ran past its last step: what happens when nobody acts has happened.
  if (status === "ongoing" && clock >= situation.pressure.length) {
    status = "left";
    outcomeText = `The pressure ran out: ${situation.pressure.at(-1)}`;
  }

  const passive =
    context.recentUserLengths.length >= PASSIVE_TURNS &&
    context.recentUserLengths.slice(-PASSIVE_TURNS).every((length) => length < PASSIVE_USER_CHARS);
  // Lingering past the limit without the player enjoying it here: the moment passes and the story moves on.
  if (
    status === "ongoing" &&
    from.replies + 1 >= LINGER_LIMIT[state.request.length] &&
    (tick.pacing !== "hold" || passive)
  ) {
    status = "left";
    outcomeText = "The moment passed before it was settled.";
  }

  let pacing: CampaignPacing = tick.pacing;
  let endingId = tick.endingId && endingIds.has(tick.endingId) ? tick.endingId : null;
  let situationId = situation.id;
  let replies = from.replies + 1;
  const outcomes = [...from.outcomes];

  if (status !== "ongoing") {
    const exit = situation.exits.find((candidate) => candidate.id === tick.exitId) ?? null;
    outcomes.push({
      situationId: situation.id,
      text: outcomeText || (exit ? exit.text : "Left behind."),
    });
    const played = new Set(outcomes.map((outcome) => outcome.situationId));
    const named =
      exit?.leadsTo && situationById(state, exit.leadsTo) && !played.has(exit.leadsTo) ? exit.leadsTo : null;
    const next = named ?? nextSituationId(state, situation, played);
    if (next) {
      situationId = next;
      clock = 0;
      replies = 0;
      if (pacing !== "land") pacing = "turn";
    } else {
      // Nothing left to play: land an ending.
      pacing = "land";
      endingId ??= state.plan.endings[0]?.id ?? null;
    }
  } else if (pacing === "turn") {
    // "Turn" means moving on, which only a resolved situation does.
    pacing = "press";
  }

  if (endingId) pacing = "land";
  if (pacing === "hold" && status === "ongoing") {
    if (replies >= PATIENCE[state.request.length] || passive) pacing = "press";
  }

  const next: CampaignProgress = {
    key: context.key,
    situationId,
    clock,
    replies,
    outcomes,
    facts,
    debts,
    revealedClueIds: revealed,
    stances,
    ladder,
    pacing,
    endingId,
    turn: from.turn + 1,
  };
  return next;
}

/**
 * Stores a new snapshot after `from`: later snapshots (from replies that were replaced) are dropped, `start` is
 * always kept, and only the newest few are kept besides it.
 */
export function withProgress(
  state: RoleplayCampaignState,
  from: CampaignProgress,
  next: CampaignProgress,
  now: string,
): RoleplayCampaignState {
  const fromIndex = state.progress.indexOf(from);
  const kept = state.progress.slice(1, fromIndex >= 0 ? fromIndex + 1 : state.progress.length);
  const progress = [state.progress[0]!, ...[...kept, next].slice(-KEPT_SNAPSHOTS)];
  // A ending landed in the reply after `land` was asked for: the campaign is over.
  const ended = from.pacing === "land" && from.endingId !== null;
  return { ...state, progress, status: ended ? "ended" : state.status, updatedAt: now };
}

/**
 * The campaign switched off (the chat plays on as an ordinary roleplay, nothing deleted) or back on. An ended campaign
 * stays ended.
 */
export function campaignWithStatus(
  state: RoleplayCampaignState,
  status: "playing" | "off",
  now: string,
): RoleplayCampaignState {
  if (state.status === "ended") return state;
  return { ...state, status, updatedAt: now };
}

/** Whether this snapshot asks for a replan and enough replies have passed since the last one. */
export function replanDue(state: RoleplayCampaignState, progress: CampaignProgress, asked: boolean): boolean {
  if (!asked || state.status !== "playing" || progress.endingId) return false;
  return progress.turn - state.lastReplanTurn >= REPLAN_GAP;
}

/** The situations a replan may not touch: everything already resolved, and the one in play. */
export function playedSituationIds(progress: CampaignProgress): Set<string> {
  return new Set([...progress.outcomes.map((outcome) => outcome.situationId), progress.situationId]);
}

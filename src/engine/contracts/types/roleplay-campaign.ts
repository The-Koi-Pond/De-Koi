/**
 * Roleplay campaigns: a hidden, pre-planned story the player walks into. The plan lives on the chat as
 * `metadata.roleplayCampaign`; the writer only ever sees the current situation (see campaign-context.ts), and a
 * background runner moves the story along after each reply (campaign-runner.ts).
 */

/** What the player is here for. A campaign has a primary focus and maybe a secondary one. */
export type CampaignFocus = "story" | "character" | "challenge";

/** How sex is handled: kept out, faded to black, or written on the page. */
export type CampaignHeat = "none" | "fade" | "explicit";

/** Rough play length: short ~30 replies, medium ~80, long ~200. */
export type CampaignLength = "short" | "medium" | "long";

/**
 * What the next reply should do with the current situation: stay in it, bring the pressure, resolve it and open the
 * next one, or land an ending.
 */
export type CampaignPacing = "hold" | "press" | "turn" | "land";

type CampaignStatus = "playing" | "ended" | "off";

export interface CampaignRequest {
  /** The player's own words. */
  ask: string;
  focus: CampaignFocus;
  secondaryFocus: CampaignFocus | null;
  heat: CampaignHeat;
  /** Things that must never happen in this campaign, in the player's words. */
  limits: string[];
  length: CampaignLength;
  /** True when the player chose to go in without even the teaser. */
  blind: boolean;
}

interface CampaignLadderStage {
  /** What this stage of closeness looks like in play. */
  looksLike: string;
  /** What has to happen for the next stage to open. */
  opensNext: string;
}

interface CampaignCastMember {
  id: string;
  name: string;
  role: string;
  want: string;
  fear: string;
  secret: string;
  /** How they treat the player's character at the start. */
  towardPlayer: string;
  /** Stages of closeness with the player; empty when this character is not a relationship focus. */
  ladder: CampaignLadderStage[];
}

interface CampaignTruth {
  id: string;
  text: string;
}

export interface CampaignClue {
  id: string;
  text: string;
  /** The key truth this clue points to. */
  truthId: string;
}

interface CampaignEnding {
  id: string;
  /** When this ending is reached, in plain words. */
  condition: string;
  tone: string;
}

interface CampaignExit {
  id: string;
  /** One way the situation can resolve. */
  text: string;
  /** What it costs or changes. */
  consequence: string;
  /** The situation it leads to; null means "the next one in order". */
  leadsTo: string | null;
}

export interface CampaignSituation {
  id: string;
  act: number;
  title: string;
  /** What is going on when the player arrives. */
  happening: string;
  /** The question the player has to answer here. For a dilemma, what each side costs. */
  question: string;
  /** Cast ids present. */
  present: string[];
  /** The clock: what happens, step by step, if the player does nothing. 2-4 steps. */
  pressure: string[];
  /** Clue ids that may surface here. */
  clueIds: string[];
  /** Things that must not come out yet while this situation is in play. */
  holds: string[];
  exits: CampaignExit[];
}

export interface CampaignPlan {
  title: string;
  /** 2-3 spoiler-free sentences: the only plan text a player sees by default. */
  pitch: string;
  /** What is really going on. */
  truth: string;
  keyTruths: CampaignTruth[];
  /** The campaign's own short rules for the narrator. Always in the prompt. */
  tableRules: string;
  cast: CampaignCastMember[];
  clues: CampaignClue[];
  endings: CampaignEnding[];
  situations: CampaignSituation[];
  /** Bumped every time unplayed situations are rewritten. */
  revision: number;
}

interface CampaignDebt {
  id: string;
  /** A consequence owed back to the player. */
  text: string;
  due: "soon" | "later";
}

interface CampaignOutcome {
  situationId: string;
  /** One line: how it resolved. */
  text: string;
}

/**
 * Where the story stands after one specific reply. The campaign keeps a short ring of these, keyed by the reply they
 * describe, so a regenerated, edited or deleted reply rolls the campaign back to the matching point.
 */
export interface CampaignProgress {
  /** `start`, or the processed assistant reply's key (id plus a hash of its text). */
  key: string;
  situationId: string;
  /** How many pressure steps have landed in the current situation. */
  clock: number;
  /** Replies spent in the current situation. */
  replies: number;
  outcomes: CampaignOutcome[];
  facts: string[];
  debts: CampaignDebt[];
  revealedClueIds: string[];
  /** Cast id -> where they stand with the player now, one line. */
  stances: Record<string, string>;
  /** Cast id -> current ladder stage index. */
  ladder: Record<string, number>;
  pacing: CampaignPacing;
  /** Set once an ending is reached. */
  endingId: string | null;
  /** Assistant replies processed so far. */
  turn: number;
}

export interface RoleplayCampaignState {
  version: 1;
  status: CampaignStatus;
  request: CampaignRequest;
  plan: CampaignPlan;
  /** Oldest first; the first is always the `start` snapshot. */
  progress: CampaignProgress[];
  /** `turn` of the last replan, so replans stay rare. */
  lastReplanTurn: number;
  /** Library rows the campaign created, so the player can find them and a failed build can remove them. */
  narratorCharacterId: string | null;
  lorebookId: string | null;
  createdAt: string;
  updatedAt: string;
}

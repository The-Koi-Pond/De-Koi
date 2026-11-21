// Every prompt the campaign sends: the builder's steps, the runner's read of each exchange, and the replan.
import type { LlmMessage } from "../../../capabilities/llm";
import type {
  CampaignLength,
  CampaignProgress,
  CampaignRequest,
  RoleplayCampaignState,
} from "../../../contracts/types/roleplay-campaign";
import { readString, type JsonRecord } from "../../../generation/runtime-records";
import { libraryPromptLines, type CampaignLibrary } from "./campaign-library";
import type { CampaignBible, CampaignSituations } from "./campaign-schemas";
import { playedSituationIds, situationById } from "./campaign-state";

const SITUATION_COUNT: Record<CampaignLength, number> = { short: 5, medium: 9, long: 13 };
const LENGTH_WORDS: Record<CampaignLength, string> = {
  short: "a short campaign, about 30 replies of play",
  medium: "a medium campaign, about 80 replies of play",
  long: "a long campaign, about 200 replies of play",
};

export interface PlayerPersona {
  name: string;
  description: string;
}

/** What every planning step knows besides the request: who the player plays and their own characters and world. */
export interface PlannerContext {
  persona: PlayerPersona | null;
  library: CampaignLibrary;
  /**
   * The player's own answer to "anything off the table?" (and limits Deki-senpai passed on). Only the bible step
   * reads it; the limits it settles on become the request's limits.
   */
  offTable?: string;
}

const AUDIENCE = [
  "The campaign is played in an AI roleplay app by one player who wants to relax and enjoy it, not direct it.",
  "They came for a mix of story, closeness with characters, challenge, and often sex. Serve what they asked for.",
  "Plan with the care of a well-made published adventure: a hidden truth, a cast that wants things, real choices that cost something, consequences that come back, more than one ending.",
  "It is not a rules game: no stats, dice, hit points or inventory. Everything is decided in the fiction.",
].join(" ");

const FOCUS_GUIDE: Record<CampaignRequest["focus"], string> = {
  story:
    "Story first: the spine is a hidden truth uncovered through reveals and hard choices. Every act changes what the player understands.",
  character:
    "Character first: the spine is the player's relationship with one or two cast members. Give each of them a closeness ladder of 3-5 stages; the relationship changing IS the plot, and the outside story exists to put pressure on it.",
  challenge:
    "Challenge first: the spine is a hard problem. Obstacles have more than one way through, cleverness is rewarded, and failure changes the situation instead of ending the game.",
};

const HEAT_GUIDE: Record<CampaignRequest["heat"], string> = {
  none: "No sexual content. Affection and attraction may exist, but nothing sexual happens on or off the page.",
  fade: "Romance, flirting and tension on the page; when sex happens, cut away and pick up after. What it changes still matters.",
  explicit: [
    "Sex is a normal, explicit part of this campaign, written on the page when the player goes there. Treat it as story, not a reward:",
    "desire is part of what characters want, intimacy changes relationships and has stakes (what is risked, revealed or owed after),",
    "and characters have their own tastes, limits and initiative. Kinks named in the ask are welcome and should be woven into who the characters are.",
    "All characters are adults.",
  ].join(" "),
};

function focusLines(request: CampaignRequest, focusKnown: boolean): string[] {
  if (!focusKnown) {
    return [
      "Focus: not given. Read the ask and decide which of these comes first, and which (if any) second; put them in focus and secondaryFocus.",
      ...Object.entries(FOCUS_GUIDE).map(([focus, guide]) => `- ${focus}: ${guide}`),
    ];
  }
  return [
    `Focus: ${request.focus}${request.secondaryFocus ? `, then ${request.secondaryFocus}` : ""}. ${FOCUS_GUIDE[request.focus]}`,
    ...(request.secondaryFocus ? [`Secondary: ${FOCUS_GUIDE[request.secondaryFocus]}`] : []),
  ];
}

function limitLines(request: CampaignRequest, offTable: string | undefined): string[] {
  if (offTable !== undefined) {
    return offTable.trim()
      ? [
          `The player's answer to "anything off the table?", in their words: """${offTable.trim()}"""`,
          'Read it the way a person would and put only real hard limits in the limits field. "No", "none", "nothing" or "go crazy" mean there are none, and "go crazy" or "don\'t hold back" is a nudge to push the ask further.',
        ]
      : ["The player named no hard limits; the limits field is empty."];
  }
  return [
    request.limits.length > 0
      ? `Hard limits, never in this campaign: ${request.limits.join("; ")}.`
      : "No hard limits were named.",
  ];
}

function requestLines(request: CampaignRequest, context: PlannerContext, focusKnown = true): string[] {
  const { persona } = context;
  return [
    `The player's ask, in their words: """${request.ask}"""`,
    ...focusLines(request, focusKnown),
    `Heat: ${HEAT_GUIDE[request.heat]}`,
    ...limitLines(request, context.offTable),
    `Length: ${LENGTH_WORDS[request.length]}.`,
    persona
      ? `The player's character: ${persona.name}. ${persona.description}`.trim()
      : "The player's character is whoever the player plays; give them a clear role in the setting and nothing more.",
    ...libraryPromptLines(context.library),
  ];
}

const CRAFT = [
  "Craft rules:",
  "- Every word of the ask is a wish. If it says sad, horny, heartwarming and weird, all four carry weight in the plan, not just one.",
  "- Specific beats generic. Give people, places and creatures concrete physical detail, habits and contradictions. Avoid stock fantasy names (Elara, Kael, Lyra, Seraphina, Thorne, Vex and the like) and stock phrases.",
  "- Every cast member wants something that pulls against someone else, fears something, and hides something that matters to the plot.",
  "- Never decide the player's feelings, choices, history or body beyond what the ask says. The player's choices drive everything.",
  "- Plan situations, not scripts: what is happening and what is at stake, never what the player will do.",
].join("\n");

export const BIBLE_SHAPE = `{
  "focus": "story | character | challenge",
  "secondaryFocus": "story | character | challenge | null",
  "limits": ["hard limits, only ones the player actually set; [] when none"],
  "title": "campaign name, 2-5 words",
  "pitch": "2-3 spoiler-free sentences that make the player want to start",
  "truth": "what is really going on, for the GM only (max 150 words)",
  "keyTruths": [{ "id": "short-id", "text": "one thing the player can discover" }],
  "tableRules": "max 120 words, written to the narrator, specific to THIS campaign: tone, how consequences work here, how intimacy is handled, what the narrator never does",
  "cast": [{ "id": "short-id", "name": "", "role": "", "want": "", "fear": "", "secret": "", "towardPlayer": "how they treat the player at first", "ladder": [{ "looksLike": "this stage of closeness in play", "opensNext": "what has to happen for the next stage" }] }],
  "endings": [{ "id": "short-id", "condition": "when it happens, in terms of what the player did", "tone": "" }]
}`;

export function bibleMessages(request: CampaignRequest, context: PlannerContext, focusKnown: boolean): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are preparing a roleplay campaign as its game master. This is your private prep; spoil freely here.",
        AUDIENCE,
        CRAFT,
        "Step 1 of 3: the campaign bible.",
        "- 2 to 5 cast members (more only if the ask needs a crowd). Characters the relationship focus is about get a ladder of 3-5 stages; others get an empty ladder.",
        "- 1 to 3 key truths the player can discover.",
        "- 2 to 4 endings that differ in what they mean, each reached by the player's own choices. No ending is just 'you lose'.",
        "Respond with only one JSON object in this exact shape:",
        BIBLE_SHAPE,
      ].join("\n"),
    },
    { role: "user", content: requestLines(request, context, focusKnown).join("\n") },
  ];
}

export const SITUATIONS_SHAPE = `{
  "clues": [{ "id": "short-id", "text": "something the player can see, hear or find", "truthId": "a keyTruths id" }],
  "situations": [{
    "id": "short-id", "act": 1, "title": "2-5 words",
    "happening": "what is going on as the player arrives, concrete (max 90 words)",
    "question": "the open question the player must answer; for a dilemma, what each side costs",
    "present": ["cast ids"],
    "pressure": ["step 1 if the player does nothing", "step 2, worse", "optional step 3"],
    "clueIds": ["clue ids that may surface here"],
    "holds": ["what must not come out yet while this plays"],
    "exits": [{ "id": "short-id", "text": "one way it can resolve", "consequence": "what it costs or changes", "leadsTo": "a situation id, or null for the next in order" }]
  }]
}`;

function situationRules(request: CampaignRequest, count: number): string {
  return [
    `Step 2 of 3: about ${count} situations in 2-3 acts, in play order, and the clues.`,
    "- The first situation starts with the player already in it, and a real choice arrives within the first three replies.",
    "- The ask's main draw (the creatures, the relationship, the heat, the tone it names) is on stage in the first situation and in most situations after it. Never save what the player asked for for later; build the mystery and the stakes around it.",
    "- Keep each situation tight: it should settle in about three to six replies of play.",
    "- Each situation has 2-4 distinct exits, each with a consequence, and a pressure clock of 2-4 steps that gets worse if the player does nothing.",
    "- A dilemma costs something on every side. No free right answer.",
    "- Three-clue rule: every key truth has at least three clues, placed in at least three different situations.",
    "- Vary the kinds: quiet and intimate, tense, revealing, choosing. Not every situation is a crisis; the player needs room to enjoy the characters.",
    "- Nothing may depend on the player doing one specific thing. If they skip a situation, the story still works.",
    "- Use leadsTo for real branches; most exits can lead to the next situation in order (null).",
    ...(request.focus === "character" || request.secondaryFocus === "character"
      ? ["- Give every ladder stage a situation where closeness can move, with the character present."]
      : []),
    ...(request.focus === "challenge" || request.secondaryFocus === "challenge"
      ? ["- Every obstacle has at least two ways through: force, talk, cleverness, sacrifice, help."]
      : []),
    ...(request.heat === "explicit"
      ? ["- Intimate situations are full situations with stakes: what is risked, revealed or changed by them."]
      : []),
  ].join("\n");
}

export function situationMessages(
  request: CampaignRequest,
  context: PlannerContext,
  bible: CampaignBible,
): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are preparing a roleplay campaign as its game master. This is your private prep; spoil freely here.",
        AUDIENCE,
        CRAFT,
        situationRules(request, SITUATION_COUNT[request.length]),
        "Respond with only one JSON object in this exact shape:",
        SITUATIONS_SHAPE,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        ...requestLines(request, { ...context, offTable: undefined }),
        "",
        "The bible:",
        JSON.stringify(bible, null, 1),
      ].join("\n"),
    },
  ];
}

const REVIEW_CHECKLIST = [
  "Review it like an editor of published adventures, then fix it:",
  "- Are the first ten minutes fun? Is the player in the middle of something with a choice right away?",
  "- Does the middle sag? Does each act change what the player knows or feels?",
  "- Does anything depend on the player doing one specific thing?",
  "- Is every part of the ask carrying weight?",
  "- Do choices come back later as consequences?",
  "- Is any situation generic, or any exit a fake choice?",
  "- Fix every listed problem.",
].join("\n");

export function reviewMessages(
  request: CampaignRequest,
  context: PlannerContext,
  bible: CampaignBible,
  draft: CampaignSituations,
  problems: string[],
): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are a game master revising your own campaign prep before play. This is private prep; spoil freely.",
        AUDIENCE,
        CRAFT,
        situationRules(request, SITUATION_COUNT[request.length]),
        REVIEW_CHECKLIST,
        "Return the full revised clues and situations, keeping what works. Respond with only one JSON object in this exact shape:",
        SITUATIONS_SHAPE,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        ...requestLines(request, { ...context, offTable: undefined }),
        "",
        "The bible:",
        JSON.stringify(bible, null, 1),
        "",
        "The draft:",
        JSON.stringify(draft, null, 1),
        "",
        problems.length > 0
          ? `Problems found by the checks:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
          : "The checks found no structural problems.",
      ].join("\n"),
    },
  ];
}

export const CONTENT_SHAPE = `{
  "narrator": {
    "name": "the campaign's name, used as the narrator's name",
    "description": "the narrator's voice and style for this campaign, plus how the setting looks, sounds and smells; no secrets, no future events (max 300 words)",
    "personality": "how the cast members speak and carry themselves, one short line each; nothing secret"
  },
  "lorebook": [{ "name": "entry name", "keys": ["words that bring it up"], "content": "what anyone in the world could know (60-150 words)" }],
  "opening": "the first message"
}`;

export function contentMessages(
  request: CampaignRequest,
  context: PlannerContext,
  bible: CampaignBible,
  situations: CampaignSituations,
): LlmMessage[] {
  const first = situations.situations[0];
  return [
    {
      role: "system",
      content: [
        "You are a game master writing what the players' app needs to run your campaign. This text is player-facing or nearly so: it must spoil nothing.",
        AUDIENCE,
        "Step 3 of 3:",
        "- narrator: a narrator card. Voice and style for this campaign and the sensory feel of the setting. Never the truth, a secret, a clue's meaning, or anything that happens later.",
        "- lorebook: 6-16 short entries of world facts that anyone there would know: places, groups, customs, and each new cast member's public face (look, manner, voice, what people say about them). Keys are names and words that should bring the entry up. No secrets, no plot, no rules, no instructions. Skip the player's own characters and anything their own lorebooks already cover: those come with the chat.",
        "- opening: the first message of play, 250-450 words, in second person and present tense. Drop the player into the first situation mid-moment with something concrete to react to. End on a moment that invites a response, not a question to the player. Never write the player's words, choices, thoughts or feelings.",
        "Write so it reads easily on the first pass: plain, concrete sentences in a natural order, one vivid detail where it counts instead of an image in every line, no riddles, no stacked metaphors, no sentence fragments for effect. The player's own characters sound exactly like their cards.",
        "Avoid stock phrases and AI tells: no 'a mix of', no 'the air thick with', no 'something shifts', no 'not X but Y' habit.",
        "Respond with only one JSON object in this exact shape:",
        CONTENT_SHAPE,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        ...requestLines(request, { ...context, offTable: undefined }),
        "",
        "The bible (secrets included so you know what to keep out):",
        JSON.stringify(bible, null, 1),
        "",
        "The first situation:",
        JSON.stringify(first, null, 1),
      ].join("\n"),
    },
  ];
}

// ── Runner ────────────────────────────────────────────────────────────────

export const TICK_SHAPE = `{
  "situation": "ongoing | resolved | left",
  "exitId": "the exit id that matches what happened, or null",
  "outcome": "one line: how it resolved, if it did",
  "clockAdvanced": false,
  "newFacts": ["what changed and will matter later, one short line each"],
  "revealedClueIds": ["clue ids the reply actually showed"],
  "debtsCreated": [{ "text": "a consequence owed back to the player later", "due": "soon | later" }],
  "debtsPaidIds": ["debt ids the reply paid off"],
  "stances": [{ "castId": "", "text": "where they stand with the player now" }],
  "ladder": [{ "castId": "", "stage": 0 }],
  "pacing": "hold | press | turn | land",
  "endingId": "an ending id if its condition is now met, else null",
  "replan": false,
  "replanWhy": ""
}`;

const MAX_TURN_CHARS = 2_400;

function transcript(turns: readonly JsonRecord[]): string {
  return turns
    .map((turn) => {
      const who = readString(turn.role) === "user" ? "PLAYER" : "NARRATOR";
      return `${who}: ${readString(turn.content).trim().slice(0, MAX_TURN_CHARS)}`;
    })
    .join("\n\n");
}

export function tickMessages(
  state: RoleplayCampaignState,
  progress: CampaignProgress,
  turns: readonly JsonRecord[],
): LlmMessage[] {
  const situation = situationById(state, progress.situationId);
  const played = playedSituationIds(progress);
  const upcoming = state.plan.situations
    .filter((candidate) => !played.has(candidate.id))
    .slice(0, 3)
    .map((candidate) => `${candidate.id}: ${candidate.title} — ${candidate.happening}`);
  const revealed = new Set(progress.revealedClueIds);
  return [
    {
      role: "system",
      content: [
        "You keep the game master's notes for a roleplay campaign. Read the latest exchange and report what changed. Be literal: count only what is on the page, not what was hinted or planned.",
        "- situation: 'resolved' when the player's action answered the open question (name the matching exitId, or describe the outcome in one line if none matches); 'left' when the player walked away from it entirely; otherwise 'ongoing'.",
        "- clockAdvanced: true only if the reply showed the next pressure step happening.",
        "- revealedClueIds: only clues the reply showed or said outright.",
        "- newFacts: lasting changes only: a promise or deal, a secret learned, an injury, something gained or lost, a way closed for good, a relationship that shifted. Never scene details, positions, distances or timings. Most exchanges add none or one.",
        "- debtsCreated: a promise made, an enemy made, a wound, a theft, a kindness: something that should come back. Rare; most exchanges create none.",
        "- ladder: a cast member's closeness stage (0-based) only when the reply clearly moved it.",
        "- pacing for the NEXT reply: 'hold' while the player is enjoying something here (talking, intimacy, exploring); 'press' when the scene idles or the player is waiting for something to happen; 'turn' only together with resolved/left; 'land' when an ending's condition is met.",
        "- replan: true only when the player is heading somewhere the upcoming situations don't cover, made one of them impossible, or plainly wants a different kind of game.",
        "Respond with only one JSON object in this exact shape:",
        TICK_SHAPE,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Current situation: ${JSON.stringify(situation)}`,
        `Pressure steps already landed: ${progress.clock}`,
        `Cast: ${state.plan.cast.map((member) => `${member.id} = ${member.name}${member.ladder.length ? ` (ladder ${member.ladder.length} stages, now ${progress.ladder[member.id] ?? 0})` : ""}`).join("; ")}`,
        `Clues not yet shown: ${
          state.plan.clues
            .filter((clue) => !revealed.has(clue.id))
            .map((clue) => `${clue.id}: ${clue.text}`)
            .join(" | ") || "none"
        }`,
        `Open debts: ${progress.debts.map((debt) => `${debt.id}: ${debt.text}`).join(" | ") || "none"}`,
        `Endings: ${state.plan.endings.map((ending) => `${ending.id}: ${ending.condition}`).join(" | ")}`,
        `Upcoming situations: ${upcoming.join(" | ") || "none left"}`,
        `Pacing asked for the reply below: ${progress.pacing}`,
        "",
        "The latest exchange:",
        transcript(turns),
      ].join("\n"),
    },
  ];
}

export const REPLAN_SHAPE = `{
  "situations": [ /* the unplayed situations, same shape as before, in play order */ ],
  "clues": [ /* only NEW clues, same shape as before */ ],
  "endings": [{ "id": "", "condition": "", "tone": "" }]
}`;

export function replanMessages(
  state: RoleplayCampaignState,
  progress: CampaignProgress,
  recent: readonly JsonRecord[],
  why: string,
): LlmMessage[] {
  const played = playedSituationIds(progress);
  const remaining = state.plan.situations.filter((situation) => !played.has(situation.id));
  const current = situationById(state, progress.situationId);
  return [
    {
      role: "system",
      content: [
        "You are the game master of a roleplay campaign in play. The player has gone somewhere the plan did not expect. Rewrite the unplayed part of the plan the way a professional GM would:",
        "- Say yes. Follow what the player is clearly interested in.",
        "- Move open questions and unshown clues to where the player is going. Let skipped material die quietly.",
        "- What they walked away from keeps moving without them and comes back as consequences.",
        "- Never undo or contradict anything already shown. The truth, the cast and every played situation stay fixed.",
        "- If the player plainly wants a different kind of game, rebuild around that.",
        "- Keep about as many situations as remain now. Keep the three-clue rule for every truth not yet found. Endings may change to fit.",
        "Situations use the same shape as the plan's. leadsTo may name a new situation id, or null for the next in order.",
        "Respond with only one JSON object in this exact shape:",
        REPLAN_SHAPE,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Why a replan: ${why || "the player has left the planned road"}`,
        `Truth: ${state.plan.truth}`,
        `Key truths: ${JSON.stringify(state.plan.keyTruths)}`,
        `Cast: ${JSON.stringify(state.plan.cast)}`,
        `Clues (shown: ${progress.revealedClueIds.join(", ") || "none"}): ${JSON.stringify(state.plan.clues)}`,
        `Played so far: ${JSON.stringify(progress.outcomes)}`,
        `In play now (fixed): ${JSON.stringify(current)}`,
        `Facts: ${JSON.stringify(progress.facts)}`,
        `Debts: ${JSON.stringify(progress.debts)}`,
        `Unplayed situations to rewrite: ${JSON.stringify(remaining)}`,
        `Endings now: ${JSON.stringify(state.plan.endings)}`,
        "",
        "Recent play:",
        transcript(recent),
      ].join("\n"),
    },
  ];
}

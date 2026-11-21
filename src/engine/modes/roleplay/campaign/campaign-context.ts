// What the writer sees of a campaign on each reply: the table rules and the current situation, never the whole plan.
import type { GenerationContextAttributionItem } from "../../../contracts/types/chat";
import type {
  CampaignPacing,
  CampaignProgress,
  CampaignSituation,
  RoleplayCampaignState,
} from "../../../contracts/types/roleplay-campaign";
import type { JsonRecord } from "../../../generation/runtime-records";
import { currentProgress, readCampaign, situationById } from "./campaign-state";

export interface CampaignPromptContext {
  block: string;
  attributionItems: GenerationContextAttributionItem[];
}

const MAX_FACTS = 6;
const MAX_CLUES = 2;

function pacingLine(
  pacing: CampaignPacing,
  situation: CampaignSituation,
  progress: CampaignProgress,
  state: RoleplayCampaignState,
): string {
  switch (pacing) {
    case "hold":
      return "This reply: stay in the moment. Let the player linger, talk, touch and explore. React fully to what they did; bring no new pressure unless they invite it.";
    case "press": {
      const step = situation.pressure[Math.min(progress.clock, situation.pressure.length - 1)];
      return `This reply: bring the pressure in now. Something happens that the player has to answer: ${step}`;
    }
    case "turn": {
      const last = progress.outcomes.at(-1);
      return [
        "This reply: move the story on.",
        last ? `Show what the player's last choice led to (${last.text}),` : "Close what just happened,",
        "then carry them into the new situation below. One smooth bridge; no summary, no time-skip unless it fits.",
      ].join(" ");
    }
    case "land": {
      const ending = state.plan.endings.find((candidate) => candidate.id === progress.endingId);
      return [
        "This reply: an ending has been reached.",
        ending ? `Land it (${ending.tone}): ${ending.condition}.` : "Land it.",
        "Pay off what the player actually did, answer the main question, and leave a moment of afterglow. Do not invent a new threat.",
      ].join(" ");
    }
  }
}

/** `text` as one sentence: trailing dots and spaces trimmed, one full stop added. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, "");
  return /[!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function castLines(state: RoleplayCampaignState, situation: CampaignSituation, progress: CampaignProgress): string[] {
  return state.plan.cast
    .filter((member) => situation.present.includes(member.id))
    .map((member) => {
      const stance = progress.stances[member.id] ?? member.towardPlayer;
      const stage = member.ladder[progress.ladder[member.id] ?? 0];
      return [
        `- ${member.name} (${member.role}). Wants: ${sentence(member.want)}`,
        `With the player: ${sentence(stance)}`,
        stage ? `Closeness now: ${sentence(stage.looksLike)} Opens next when: ${sentence(stage.opensNext)}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    });
}

function clueLines(state: RoleplayCampaignState, situation: CampaignSituation, progress: CampaignProgress): string[] {
  const revealed = new Set(progress.revealedClueIds);
  return state.plan.clues
    .filter((clue) => situation.clueIds.includes(clue.id) && !revealed.has(clue.id))
    .slice(0, MAX_CLUES)
    .map((clue) => `- ${clue.text}`);
}

/** The prompt text for one reply, from the plan and the snapshot it continues from. */
function campaignBlock(state: RoleplayCampaignState, progress: CampaignProgress): string | null {
  const situation = situationById(state, progress.situationId);
  if (!situation) return null;
  const pressureStep = situation.pressure[Math.min(progress.clock, situation.pressure.length - 1)];
  const cast = castLines(state, situation, progress);
  const clues = clueLines(state, situation, progress);
  const debt = progress.debts.find((candidate) => candidate.due === "soon") ?? progress.debts[0];
  const facts = progress.facts.slice(-MAX_FACTS);
  const limits = state.request.limits.length > 0 ? `Never: ${state.request.limits.join("; ")}.` : "";
  return [
    "<campaign>",
    "Private notes from the game master for this reply. Use them to decide what happens; never quote them, mention a plan or a game master, or let a character know something only these notes say.",
    `Table rules: ${state.plan.tableRules}${limits ? ` ${limits}` : ""}`,
    "",
    progress.replies === 0
      ? `Situation — ${situation.title}. How it opens: ${situation.happening}`
      : `Situation — ${situation.title}, already under way (don't restage how it began): ${situation.happening}`,
    `The open question for the player: ${situation.question}`,
    `If the player lets it ride: ${pressureStep}`,
    ...(cast.length > 0 ? ["Present:", ...cast] : []),
    ...(clues.length > 0 ? ["May come out if the player looks or asks (show, don't explain):", ...clues] : []),
    ...(situation.holds.length > 0 ? [`Keep hidden for now: ${situation.holds.join("; ")}.`] : []),
    ...(facts.length > 0 ? ["What has changed so far:", ...facts.map((fact) => `- ${fact}`)] : []),
    ...(debt ? [`Owed to the player (bring it back when it fits): ${debt.text}`] : []),
    "",
    pacingLine(progress.pacing, situation, progress, state),
    "The player's latest message wins over everything here. Never write the player's words, choices, thoughts or feelings. If they do something unexpected, play it straight with real consequences instead of steering them back.",
    "</campaign>",
  ].join("\n");
}

/**
 * The campaign block for the next reply, or null when the chat is not a playing campaign. `messages` is the history
 * the reply is built on, so a regenerated reply uses the snapshot from before the reply it replaces.
 */
export function buildCampaignContext(input: {
  chatId: string;
  chatMode: string;
  metadata: unknown;
  messages: readonly JsonRecord[];
}): CampaignPromptContext | null {
  if (input.chatMode !== "roleplay") return null;
  const state = readCampaign(input.metadata);
  if (!state || state.status !== "playing") return null;
  const progress = currentProgress(state, input.messages);
  const block = campaignBlock(state, progress);
  if (!block) return null;
  return {
    block,
    attributionItems: [
      {
        kind: "campaign",
        // The snippet would spoil the campaign wherever attribution is shown; the plan is behind the screen.
        label: "Campaign game master notes (hidden)",
        status: "injected",
        sourceId: progress.key,
        sourceCollection: "chats",
        parentSourceId: input.chatId,
        snippet: null,
        metadata: { planRevision: state.plan.revision, turn: progress.turn, pacing: progress.pacing },
      },
    ],
  };
}

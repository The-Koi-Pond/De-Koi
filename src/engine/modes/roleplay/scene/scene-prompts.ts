// The words scene planning and summaries send to the model, and the guidelines a scene chat carries.
import type { LlmMessage } from "../../../capabilities/llm";

/** The plan's own system prompt. Whatever the planner wrote for instructions is never kept. */
export const SCENE_PLAN_SYSTEM_PROMPT =
  "Write immersive roleplay prose with consistent point of view, clear character agency, and continuity from the originating conversation.";

/** Appended to the plan's system prompt as the scene chat's instructions (`sceneSystemPrompt`). */
export const SCENE_GUIDELINES = [
  "Scene guidelines:",
  "- This is a focused scene that branched off from an earlier chat. Characters keep what they knew there and where their relationships stood.",
  "- The user alone decides what their persona does and says.",
  "- For narration and point of view, follow the preset, the earlier chat and the scene request; when they disagree, the newest explicit direction wins.",
  "- Put spoken lines in quotation marks.",
  "- The first message sets the scene and hands the next real decision to the user.",
  "- Keep playing until the scene ends or returns to the chat it came from.",
].join("\n");

const PLANNER_INSTRUCTIONS = [
  "You plan a roleplay scene for De-Koi. Reply with a single JSON object and nothing else. Its keys:",
  '- "name": a short title starting with "Scene:".',
  '- "description": one or two sentences on what the scene is about.',
  '- "scenario": the place, situation and stakes as the scene opens.',
  '- "firstMessage": the opening beat brief described below.',
  '- "background": always null. Backgrounds are chosen later, by hand or by the opt-in Background agent.',
  '- "characterIds": the characters taking part, using only the allowed IDs.',
  '- "rating": "sfw" or "nsfw".',
  '- "relationshipHistory": where the characters stand with each other and with the user going in.',
  "",
  "Leave out policy, safety, consent, participation and preset instructions; De-Koi adds those on its own.",
  "",
  "The opening beat brief plans the first reply; it is not the reply. Write exactly three labeled lines:",
  "Participants: who is there",
  "Action: what is concretely happening",
  "Pressure: what is pressing on the moment",
  "All three lines together stay under 360 characters. Name concrete people, actions and pressures. No scripted dialogue, metaphors, similes, asides or camera directions. Quote a short exact line only when the request asks for those words. Don't explain the theme, and don't force an interruption, a reveal or a choice.",
  "",
  "Honor the premise, cast, genre and opening situation the request asks for.",
].join("\n");

export function buildPlannerMessages(input: {
  allowedCharacterIds: readonly string[];
  cards: string;
  persona: string;
  recentLines: readonly string[];
  request: string;
}): LlmMessage[] {
  const ask = input.request
    ? `Plan a complete roleplay scene based on this request: ${input.request}`
    : "Plan a complete roleplay scene that naturally follows the recent conversation.";
  return [
    { role: "system", content: PLANNER_INSTRUCTIONS },
    {
      role: "user",
      content: [
        `Allowed character IDs: ${input.allowedCharacterIds.length > 0 ? input.allowedCharacterIds.join(", ") : "(none)"}`,
        `Characters:\n${input.cards}`,
        `Persona:\n${input.persona}`,
        `Recent messages:\n${input.recentLines.length > 0 ? input.recentLines.join("\n") : "(none)"}`,
        ask,
      ].join("\n\n"),
    },
  ];
}

/** What every summary call is told about the scene. */
export interface SceneSummaryDetails {
  name: string;
  date: string;
  description: string;
  scenario: string;
  background: string;
  rating: string;
  relationshipHistory: string;
  originContext: string;
  cards: string;
  persona: string;
}

function detailsBlock(details: SceneSummaryDetails): string {
  const lines = [
    `Name: ${details.name}`,
    `Date: ${details.date}`,
    `Description: ${details.description || "(none)"}`,
    `Scenario: ${details.scenario || "(none)"}`,
    `Background: ${details.background || "(none)"}`,
    `Rating: ${details.rating || "sfw"}`,
    `Relationship history: ${details.relationshipHistory || "(none)"}`,
    `Earlier conversation:\n${details.originContext || "(none)"}`,
  ];
  return [`Scene details:\n${lines.join("\n")}`, `Characters:\n${details.cards}`, `Persona:\n${details.persona}`].join(
    "\n\n",
  );
}

const SECTION_INSTRUCTIONS = [
  "You summarize one section of a finished roleplay scene.",
  "Write a concise third-person summary of this section only: the concrete events, choices, emotional and relationship shifts, promises, conflicts, reveals, and hooks left open.",
  "Invent nothing. Don't leave out anything important because it is intense.",
  "Reply with the summary text only.",
].join("\n");

export function buildSectionSummaryMessages(input: {
  details: SceneSummaryDetails;
  sectionNumber: number;
  sectionCount: number;
  transcript: string;
}): LlmMessage[] {
  return [
    { role: "system", content: SECTION_INSTRUCTIONS },
    {
      role: "user",
      content: [
        `Section ${input.sectionNumber} of ${input.sectionCount}`,
        detailsBlock(input.details),
        `Section transcript:\n${input.transcript}`,
      ].join("\n\n"),
    },
  ];
}

const WHOLE_INSTRUCTIONS = [
  "You write the closing summary of a finished roleplay scene from the summaries of its sections.",
  "Write one or two compact paragraphs of 120 to 220 words, never more. Cover the premise, the key events across the whole scene, emotional and relationship shifts, outcomes, promises, conflicts, reveals and hooks left open.",
  "Use only what the section summaries say; invent nothing.",
  "Reply with a single JSON object and nothing else:",
  '{"summary": "the paragraphs", "sections": {"events": [], "choices": [], "relationshipShifts": [], "promises": [], "reveals": [], "unresolvedHooks": [], "currentState": []}}',
  "Each list holds short plain strings; leave a list empty when nothing fits.",
].join("\n");

function wholeUserContent(details: SceneSummaryDetails, sectionSummaries: readonly string[]): string {
  return [
    detailsBlock(details),
    `Section summaries:\n${sectionSummaries.map((summary, index) => `Section ${index + 1}: ${summary}`).join("\n\n")}`,
  ].join("\n\n");
}

export function buildWholeSummaryMessages(input: {
  details: SceneSummaryDetails;
  sectionSummaries: readonly string[];
}): LlmMessage[] {
  return [
    { role: "system", content: WHOLE_INSTRUCTIONS },
    { role: "user", content: wholeUserContent(input.details, input.sectionSummaries) },
  ];
}

export type WholeSummaryRetryReason = "too_long" | "too_brief";

const RETRY_REASON_TEXT: Record<WholeSummaryRetryReason, string> = {
  too_long: "The earlier answer ran past 220 words. Keep the new one between 120 and 220 words, late events included.",
  too_brief:
    "The earlier answer was too short for a scene this long. Write at least three full sentences that cover the beginning, middle and end.",
};

export function buildWholeSummaryRetryMessages(input: {
  details: SceneSummaryDetails;
  sectionSummaries: readonly string[];
  previousAnswer: string;
  reason: WholeSummaryRetryReason;
}): LlmMessage[] {
  return [
    {
      role: "system",
      content: `${WHOLE_INSTRUCTIONS}\n\nThis is a second attempt. ${RETRY_REASON_TEXT[input.reason]}`,
    },
    {
      role: "user",
      content: [
        wholeUserContent(input.details, input.sectionSummaries),
        `Earlier answer:\n${input.previousAnswer}`,
        `What to fix: ${RETRY_REASON_TEXT[input.reason]}`,
      ].join("\n\n"),
    },
  ];
}

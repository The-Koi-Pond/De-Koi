// Planning: one model call turns a request into a checked scene plan. A failed call or an answer that isn't a JSON
// object fails with its real reason; there is no made-up plan. Behavior spec: docs/provenance/roleplay-scenes.md
// ("Planning").
import { readString, stringArray, isRecord, type JsonRecord } from "../../../generation/runtime-records";
import { parseGameJsonish } from "../../../shared/parsing-jsonish";
import { userFacingError } from "../../../shared/user-facing-error";
import { requestSceneText, sceneConnection } from "./scene-calls";
import { sceneStepError } from "./scene-errors";
import { buildPlannerMessages, SCENE_PLAN_SYSTEM_PROMPT } from "./scene-prompts";
import {
  loadParticipantRows,
  loadRecentMessages,
  loadScenePersona,
  messageLines,
  participantCards,
} from "./scene-sources";
import { capAtSentenceOrWord, collapseWhitespace, countSentences, unescapeWrittenBreaks } from "./scene-text";
import type { SceneCapabilities, SceneFullPlan } from "./scene-types";

const PLANNING_MESSAGE_LIMIT = 20;
const FALLBACK_MESSAGE_LIMIT = 8;
const SCENE_NAME_LIMIT = 60;
const OPENING_BEAT_LIMIT = 360;

export const GENERIC_OPENING_BEAT =
  "Open on the planned scene's immediate situation and pressure, with the listed participants already present.";
const DEFAULT_PREMISE = "A focused roleplay scene continues from the current conversation.";
const NOT_A_PLAN_MESSAGE = "The model's answer wasn't a scene plan. Try again, or switch to a stronger model.";

export interface PlanSceneInput {
  chatId: string;
  /** What the scene should be; empty plans one that follows the recent conversation. */
  request: string;
  connectionId?: string | null;
}

/** What the checks fall back on: the request, the chat's own characters and its recent visible messages. */
interface ScenePlanContext {
  request: string;
  chatCharacterIds: readonly string[];
  recentMessages: readonly JsonRecord[];
}

/** Plans a scene from the chat's characters, persona and last messages. Throws with the real reason on failure. */
export async function planRoleplayScene(
  capabilities: SceneCapabilities,
  input: PlanSceneInput,
): Promise<SceneFullPlan> {
  const { storage } = capabilities;
  const chat = await storage.get<unknown>("chats", input.chatId);
  if (!isRecord(chat)) throw userFacingError("This chat no longer exists, so a scene can't be planned from it.");
  const request = input.request.trim();
  const chatCharacterIds = stringArray(chat.characterIds);
  const [rows, persona, recentMessages] = await Promise.all([
    loadParticipantRows(storage, chatCharacterIds),
    loadScenePersona(storage, chat),
    loadRecentMessages(storage, input.chatId, PLANNING_MESSAGE_LIMIT),
  ]);
  let answer: JsonRecord;
  try {
    const raw = await requestSceneText(capabilities, {
      kind: "plan",
      connection: sceneConnection(chat, input.connectionId),
      messages: buildPlannerMessages({
        allowedCharacterIds: chatCharacterIds,
        cards: participantCards(rows),
        persona,
        recentLines: messageLines(recentMessages),
        request,
      }),
    });
    answer = readPlannerAnswer(raw);
  } catch (error) {
    throw sceneStepError("Scene planning failed", error);
  }
  return checkScenePlan(answer, { request, chatCharacterIds, recentMessages });
}

/** The planner's JSON object; anything else (prose, broken JSON, a list) is not a plan. */
function readPlannerAnswer(raw: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = parseGameJsonish(raw);
  } catch {
    throw userFacingError(NOT_A_PLAN_MESSAGE);
  }
  if (!isRecord(parsed)) throw userFacingError(NOT_A_PLAN_MESSAGE);
  return parsed;
}

function text(value: unknown): string {
  return unescapeWrittenBreaks(readString(value)).trim();
}

function sceneName(value: unknown, request: string): string {
  let name = collapseWhitespace(text(value)) || collapseWhitespace(request) || "New Scene";
  if (name.length > SCENE_NAME_LIMIT) {
    const cut = name.slice(0, SCENE_NAME_LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    name = (lastSpace > SCENE_NAME_LIMIT / 2 ? cut.slice(0, lastSpace) : cut).trimEnd();
  }
  return /^scene\s*:/i.test(name) ? name : `Scene: ${name}`;
}

function isThreeLineBeat(beat: string): boolean {
  const lines = beat
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length === 3 &&
    /^participants\s*:/i.test(lines[0]!) &&
    /^action\s*:/i.test(lines[1]!) &&
    /^pressure\s*:/i.test(lines[2]!)
  );
}

function normalizedForQuote(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

/** Dialogue in double quotes (straight or curly) that the user's request doesn't contain word for word. */
function quotesUnrequestedDialogue(beat: string, request: string): boolean {
  const requested = normalizedForQuote(request);
  for (const match of beat.matchAll(/"([^"]+)"|“([^”]+)”/g)) {
    const quoted = normalizedForQuote(match[1] ?? match[2] ?? "");
    if (quoted && !requested.includes(quoted)) return true;
  }
  return false;
}

/** The opening beat brief, or the generic beat when the planner wrote prose, too much, or dialogue nobody asked for. */
function checkOpeningBeat(value: unknown, request: string): string {
  const beat = text(value);
  if (!isThreeLineBeat(beat) || countSentences(beat) > 3 || quotesUnrequestedDialogue(beat, request)) {
    return GENERIC_OPENING_BEAT;
  }
  return capAtSentenceOrWord(beat, OPENING_BEAT_LIMIT);
}

/** Turns the planner's JSON object into a plan the scene can trust, filling empty fields from the request. */
function checkScenePlan(answer: JsonRecord, context: ScenePlanContext): SceneFullPlan {
  const request = context.request.trim();
  const ownIds = new Set(context.chatCharacterIds);
  const chosenIds = Array.from(new Set(stringArray(answer.characterIds).filter((id) => ownIds.has(id))));
  const visibleLines = messageLines(context.recentMessages);
  const lastLines = visibleLines.slice(-FALLBACK_MESSAGE_LIMIT);
  const premise = request || lastMessageContent(context.recentMessages) || DEFAULT_PREMISE;
  return {
    name: sceneName(answer.name, request),
    description: text(answer.description) || `The scene opens around this premise: ${premise}`,
    scenario:
      text(answer.scenario) ||
      [premise, lastLines.length > 0 ? `Recent conversation:\n${lastLines.join("\n")}` : ""]
        .filter(Boolean)
        .join("\n\n"),
    firstMessage: checkOpeningBeat(answer.firstMessage, request),
    characterIds: chosenIds.length > 0 ? chosenIds : [...context.chatCharacterIds],
    systemPrompt: SCENE_PLAN_SYSTEM_PROMPT,
    rating: text(answer.rating).toLowerCase() === "nsfw" ? "nsfw" : "sfw",
    relationshipHistory: text(answer.relationshipHistory) || lastLines.join("\n"),
  };
}

function lastMessageContent(messages: readonly JsonRecord[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (messageLines([message]).length > 0) return readString(message.content).trim();
  }
  return "";
}

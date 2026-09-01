import { getEffectiveMemoryRecallEnabled, type ChatMetadata } from "../contracts/types/chat";
import { hiddenFromAi, parseRecord, readString, type JsonRecord } from "./runtime-records";

export const STORY_PROJECTION_VERSION = 1 as const;
export const STORY_EPISODE_MESSAGE_THRESHOLD = 24;
export const STORY_ARC_EPISODE_THRESHOLD = 4;

export type StoryProjectionLevel = "episode" | "arc";
export type StoryEpisodeBoundaryReason = "message_threshold" | "manual" | "scene_conclusion";

export interface StoryEpisodePlan {
  level: "episode";
  chatId: string;
  boundaryReason: StoryEpisodeBoundaryReason;
  messageIds: string[];
  firstMessageId: string;
  lastMessageId: string;
}

export interface StoryEpisodeCoverage {
  episodeId: string;
  coverageId: string;
  messageIds: string[];
  firstMessageId: string;
  lastMessageId: string;
  createdAt: string;
  /** False keeps an invalidated coverage slot from being silently bridged by an arc. */
  active?: boolean;
}

export interface StoryArcPlan {
  level: "arc";
  chatId: string;
  sourceEpisodeIds: string[];
  sourceCoverageIds: string[];
  messageIds: string[];
  firstMessageId: string;
  lastMessageId: string;
}

export function getEffectiveStoryConsolidationEnabled(
  chatMode: string,
  metadata: Partial<ChatMetadata>,
): boolean {
  if (chatMode !== "roleplay" && chatMode !== "visual_novel") return false;
  if (metadata.enableStoryConsolidation === false || metadata.enableCanonicalMemoryRecall === false) return false;
  return getEffectiveMemoryRecallEnabled(chatMode, metadata);
}

function hiddenFromUser(message: JsonRecord): boolean {
  const extra = parseRecord(message.extra);
  return extra.hiddenFromUser === true || extra.hidden_from_user === true;
}

export function eligibleStoryMessages(messages: JsonRecord[]): JsonRecord[] {
  return messages.filter((message) => {
    const id = readString(message.id).trim();
    const role = readString(message.role).trim();
    const content = readString(message.content).trim();
    return (
      !!id &&
      !!content &&
      (role === "user" || role === "assistant" || role === "narrator") &&
      !hiddenFromAi(message) &&
      !hiddenFromUser(message)
    );
  });
}

function firstUncoveredRun(messages: JsonRecord[], coveredMessageIds: ReadonlySet<string>): JsonRecord[] {
  const eligible = eligibleStoryMessages(messages);
  let start = 0;
  while (start < eligible.length && coveredMessageIds.has(readString(eligible[start]?.id).trim())) start += 1;
  const run: JsonRecord[] = [];
  for (let index = start; index < eligible.length; index += 1) {
    const message = eligible[index]!;
    if (coveredMessageIds.has(readString(message.id).trim())) break;
    run.push(message);
  }
  return run;
}

export function planEpisodeCoverage(input: {
  chatId: string;
  messages: JsonRecord[];
  coveredMessageIds: ReadonlySet<string>;
  formalSceneStatus?: "active" | "concluded" | null;
  requestedBoundary?: "manual" | "scene_conclusion";
}): StoryEpisodePlan | null {
  const run = firstUncoveredRun(input.messages, input.coveredMessageIds);
  if (run.length === 0) return null;

  let selected: JsonRecord[];
  let boundaryReason: StoryEpisodeBoundaryReason;
  if (input.requestedBoundary) {
    if (input.requestedBoundary === "manual" && run.length < 2) return null;
    const last = run.at(-1);
    if (input.requestedBoundary === "manual" && readString(last?.role).trim() !== "assistant") return null;
    selected = run;
    boundaryReason = input.requestedBoundary;
  } else {
    if (run.length < STORY_EPISODE_MESSAGE_THRESHOLD) return null;
    const boundaryIndex = run.findIndex(
      (message, index) => index >= STORY_EPISODE_MESSAGE_THRESHOLD - 1 && readString(message.role).trim() === "assistant",
    );
    if (boundaryIndex < 0) return null;
    selected = run.slice(0, boundaryIndex + 1);
    boundaryReason = "message_threshold";
  }

  const messageIds = selected.map((message) => readString(message.id).trim());
  return {
    level: "episode",
    chatId: input.chatId,
    boundaryReason,
    messageIds,
    firstMessageId: messageIds[0]!,
    lastMessageId: messageIds.at(-1)!,
  };
}

export function planArcCoverage(input: {
  chatId: string;
  episodes: StoryEpisodeCoverage[];
  coveredEpisodeIds: ReadonlySet<string>;
}): StoryArcPlan | null {
  const ordered = [...input.episodes].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.episodeId.localeCompare(right.episodeId),
  );
  const selected: StoryEpisodeCoverage[] = [];
  for (const episode of ordered) {
    if (episode.active === false || input.coveredEpisodeIds.has(episode.episodeId)) {
      selected.length = 0;
      continue;
    }
    selected.push(episode);
    if (selected.length === STORY_ARC_EPISODE_THRESHOLD) break;
  }
  if (selected.length < STORY_ARC_EPISODE_THRESHOLD) return null;
  const messageIds = selected.flatMap((episode) => episode.messageIds);
  return {
    level: "arc",
    chatId: input.chatId,
    sourceEpisodeIds: selected.map((episode) => episode.episodeId),
    sourceCoverageIds: selected.map((episode) => episode.coverageId),
    messageIds,
    firstMessageId: selected[0]!.firstMessageId,
    lastMessageId: selected.at(-1)!.lastMessageId,
  };
}

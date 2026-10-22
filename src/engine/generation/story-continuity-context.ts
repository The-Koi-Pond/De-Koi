import type { StorageGateway } from "../capabilities/storage";
import type { GenerationContextAttributionItem } from "../contracts/types/chat";
import type { CanonicalMemoryRecord, StoryOpenThread, StoryProjectionPayload } from "../contracts/types/memory";
import { parseRecord, readNumber, readString, type JsonRecord } from "./runtime-records";
import { getEffectiveMemoryRecallEnabled } from "../contracts/types/chat";
import { isStoryProjectionMemory } from "./story-projections";
import { resolveEpistemicAccess, type EpistemicAccessResult, type EpistemicSubject } from "./epistemic-access";
import { loadEpistemicContext } from "./epistemic-context";

export interface StoryContinuityContextInput {
  chat: JsonRecord;
  storedMessages: JsonRecord[];
  retainedRawMessageIds?: string[];
  latestUserInput: string;
  representedText?: string[];
  maxContext?: number | null;
  epistemicSubjects?: EpistemicSubject[];
}

export interface StoryContinuityPromptContext {
  block: string;
  attributionItems: GenerationContextAttributionItem[];
  selectedMemoryIds: string[];
  estimatedTokens: number;
  consideredCount: number;
}

const DEFAULT_BUDGET_TOKENS = 360;
const MIN_BUDGET_TOKENS = 100;
const MAX_BUDGET_TOKENS = 800;
const CONTEXT_SHARE = 0.07;
// Open threads come from the newest episode's carried-forward list and get their own small allowance.
const MAX_OPEN_THREADS = 6;
const OPEN_THREAD_BUDGET_TOKENS = 220;

function payload(memory: CanonicalMemoryRecord): StoryProjectionPayload | null {
  return isStoryProjectionMemory(memory) ? (memory.payload as StoryProjectionPayload) : null;
}

function timestamp(memory: CanonicalMemoryRecord): number {
  const parsed = Date.parse(memory.updatedAt || memory.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function words(value: string): Set<string> {
  return new Set(Array.from(value.toLowerCase().matchAll(/[\p{Letter}\p{Number}]{2,}/gu), (match) => match[0]!));
}

function relevance(memory: CanonicalMemoryRecord, query: Set<string>): number {
  if (query.size === 0) return 0;
  const candidate = words(`${memory.title ?? ""} ${memory.content}`);
  let matches = 0;
  for (const token of query) if (candidate.has(token)) matches += 1;
  return matches / query.size;
}

function normalizeSentence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function sentenceSet(values: string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => value.split(/(?<=[.!?])\s+|\n+/))
      .map(normalizeSentence)
      .filter(Boolean),
  );
}

function removeRepresentedSentences(content: string, represented: Set<string>): string {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => {
      const normalized = normalizeSentence(sentence);
      return normalized && !represented.has(normalized);
    })
    .join(" ")
    .trim();
}

// Parsed, not compared as text: stored timestamps mix "Z" and "+00:00" forms.
function episodeEnd(memory: CanonicalMemoryRecord, story: StoryProjectionPayload): number {
  return Date.parse(readString(story.sourceMessages?.at(-1)?.createdAt) || memory.createdAt) || 0;
}

function packOpenThreads(threads: StoryOpenThread[], represented: Set<string>): StoryOpenThread[] {
  const packed: StoryOpenThread[] = [];
  let used = 30;
  for (const thread of threads) {
    if (packed.length >= MAX_OPEN_THREADS) break;
    const normalized = normalizeSentence(thread.text);
    if (!normalized || represented.has(normalized)) continue;
    const tokens = estimateTokens(thread.text) + 4;
    if (used + tokens > OPEN_THREAD_BUDGET_TOKENS) continue;
    packed.push(thread);
    used += tokens;
  }
  return packed;
}

function budget(input: StoryContinuityContextInput): number {
  const meta = parseRecord(input.chat.metadata);
  const explicit = readNumber(meta.storyContinuityTokenBudget, 0);
  const target = explicit > 0 ? explicit : input.maxContext ? Math.floor(input.maxContext * CONTEXT_SHARE) : 0;
  return Math.max(MIN_BUDGET_TOKENS, Math.min(MAX_BUDGET_TOKENS, target || DEFAULT_BUDGET_TOKENS));
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function pack(
  selected: CanonicalMemoryRecord[],
  representedText: string[],
  tokenLimit: number,
): Array<{ memory: CanonicalMemoryRecord; content: string }> {
  const represented = sentenceSet(representedText);
  const result: Array<{ memory: CanonicalMemoryRecord; content: string }> = [];
  let used = 45;
  for (const memory of selected) {
    const content = removeRepresentedSentences(memory.content, represented);
    if (!content) continue;
    const label = `${memory.title ?? "Story projection"}: ${content}`;
    const tokens = estimateTokens(label);
    if (used + tokens > tokenLimit) continue;
    result.push({ memory, content });
    used += tokens;
    for (const sentence of sentenceSet([content])) represented.add(sentence);
  }
  return result;
}

export async function buildStoryContinuityContext(
  storage: StorageGateway,
  input: StoryContinuityContextInput,
): Promise<StoryContinuityPromptContext | null> {
  const chatId = readString(input.chat.id).trim();
  const mode = readString(input.chat.mode || input.chat.chatMode).trim();
  const metadata = parseRecord(input.chat.metadata);
  const continuityEnabled =
    (mode === "roleplay" || mode === "visual_novel") &&
    metadata.enableCanonicalMemoryRecall !== false &&
    getEffectiveMemoryRecallEnabled(mode, metadata);
  if (!chatId || !continuityEnabled || !storage.queryMemories) return null;

  const epistemic = await loadEpistemicContext(storage, input.epistemicSubjects ?? []);

  const retainedRawIds = new Set(
    input.retainedRawMessageIds ?? input.storedMessages.slice(-4).map((message) => readString(message.id).trim()),
  );
  const queried = await storage.queryMemories({
    scope: { kind: "chat", id: chatId },
    includeInactive: true,
    ...(epistemic.enabled ? { epistemicPolicyVersion: 1 as const } : {}),
  });
  let accessByMemoryId = new Map<string, EpistemicAccessResult>();
  if (epistemic.enabled && storage.queryKnowledgeEdges) {
    try {
      const edges = await storage.queryKnowledgeEdges({ memoryIds: queried.map((memory) => memory.id) });
      accessByMemoryId = new Map(
        queried.map((memory) => [
          memory.id,
          resolveEpistemicAccess({
            memoryId: memory.id,
            edges,
            subjects: epistemic.subjects,
            groups: epistemic.groups,
          }),
        ]),
      );
    } catch {
      accessByMemoryId = new Map(
        queried.map((memory) => [
          memory.id,
          {
            admitted: false,
            classified: true,
            reason: "epistemic_unavailable" as const,
            decisions: [],
            edgeIds: [],
          },
        ]),
      );
    }
  }
  const candidateRows = queried
    .filter((memory) => memory.status === "active" || memory.status === "pinned")
    .map((memory) => ({ memory, payload: payload(memory) }))
    .filter((entry): entry is { memory: CanonicalMemoryRecord; payload: StoryProjectionPayload } => !!entry.payload)
    .filter((entry) => !entry.payload.messageIds.some((id) => retainedRawIds.has(id)));
  const excluded = candidateRows.filter((entry) => accessByMemoryId.get(entry.memory.id)?.admitted === false);
  const rows = candidateRows.filter((entry) => accessByMemoryId.get(entry.memory.id)?.admitted !== false);
  if (rows.length === 0 && excluded.length === 0) return null;

  const episodes = rows.filter((entry) => entry.payload.level === "episode");
  const arcs = rows.filter((entry) => entry.payload.level === "arc");
  const query = words(input.latestUserInput);
  const recentEpisode = [...episodes].sort((left, right) => timestamp(right.memory) - timestamp(left.memory))[0];
  const olderEpisode = episodes
    .filter((entry) => entry !== recentEpisode)
    .sort(
      (left, right) =>
        relevance(right.memory, query) - relevance(left.memory, query) ||
        timestamp(right.memory) - timestamp(left.memory),
    )[0];
  const selectedEpisodeIds = new Set([recentEpisode?.memory.id, olderEpisode?.memory.id].filter(Boolean));
  const selectedArc = arcs
    .filter((entry) => !entry.payload.sourceEpisodeIds.some((id) => selectedEpisodeIds.has(id)))
    .sort(
      (left, right) =>
        relevance(right.memory, query) - relevance(left.memory, query) ||
        timestamp(right.memory) - timestamp(left.memory),
    )[0];
  const selected = [recentEpisode, olderEpisode, selectedArc].filter(
    (entry): entry is { memory: CanonicalMemoryRecord; payload: StoryProjectionPayload } => !!entry,
  );
  const packed = pack(
    selected.map((entry) => entry.memory),
    input.representedText ?? [],
    budget(input),
  );
  // Once part of the chat has left the raw window, show the newest open-thread list. It may come from an
  // episode still inside the window: the list it carries covers the whole story so far.
  const activeEpisodes = queried
    .filter((memory) => memory.status === "active" || memory.status === "pinned")
    .flatMap((memory) => {
      const story = payload(memory);
      return story?.level === "episode" ? [{ memory, story, endedAt: episodeEnd(memory, story) }] : [];
    });
  const ledger =
    episodes.length === 0
      ? undefined
      : activeEpisodes
          .filter((entry) => entry.story.openThreads?.length)
          .filter((entry) => accessByMemoryId.get(entry.memory.id)?.admitted !== false)
          .sort((left, right) => right.endedAt - left.endedAt)[0];
  // The list carries threads forward from earlier episodes. If any of those is hidden from this responder, a
  // carried thread could repeat its secret, so show none.
  const ledgerRepeatsHidden =
    !!ledger &&
    activeEpisodes.some(
      (entry) => entry.endedAt <= ledger.endedAt && accessByMemoryId.get(entry.memory.id)?.admitted === false,
    );
  const threads =
    ledger && !ledgerRepeatsHidden
      ? packOpenThreads(
          ledger.story.openThreads ?? [],
          sentenceSet([...(input.representedText ?? []), ...packed.map(({ content }) => content)]),
        )
      : [];
  if (packed.length === 0 && threads.length === 0 && excluded.length === 0) return null;

  const block =
    packed.length > 0 || threads.length > 0
      ? [
          "<story_continuity>",
          "The following are non-authoritative narrative projections. Recent transcript and canonical atomic memories win conflicts.",
          ...packed.map(({ memory, content }) => {
            const story = payload(memory)!;
            return `- [${story.level}] ${memory.title ?? "Untitled"}: ${content}`;
          }),
          ...(threads.length > 0
            ? [
                "Open threads the story has not closed yet. Raise one only when the scene gives it room.",
                ...threads.map(
                  (thread) => `- [${thread.kind === "promise" ? "promise" : "unresolved"}] ${thread.text}`,
                ),
              ]
            : []),
          "</story_continuity>",
        ].join("\n")
      : "";
  return {
    block,
    selectedMemoryIds: packed.map(({ memory }) => memory.id),
    estimatedTokens: estimateTokens(block),
    consideredCount: rows.length,
    attributionItems: [
      ...packed.map(({ memory }, index) => {
        const story = payload(memory)!;
        return {
          kind: "story_projection",
          label: `${story.level === "episode" ? "Episode" : "Arc"} ${index + 1}`,
          status: "injected",
          sourceId: memory.id,
          sourceCollection: "canonical-memories",
          snippet: memory.content,
          metadata: {
            projectionLevel: story.level,
            firstMessageId: story.firstMessageId,
            lastMessageId: story.lastMessageId,
            sourceMessageIds: story.messageIds,
            sourceEpisodeIds: story.sourceEpisodeIds,
            epistemicPolicyVersion: accessByMemoryId.has(memory.id) ? 1 : undefined,
            epistemicReason: accessByMemoryId.get(memory.id)?.reason,
            epistemicEdgeIds: accessByMemoryId.get(memory.id)?.edgeIds,
          },
        } satisfies GenerationContextAttributionItem;
      }),
      ...excluded.map(({ memory }) => ({
        kind: "story_projection" as const,
        label: "Story projection excluded",
        status: "skipped" as const,
        sourceId: memory.id,
        sourceCollection: "canonical-memories",
        snippet: memory.content,
        metadata: {
          epistemicPolicyVersion: 1,
          epistemicReason: accessByMemoryId.get(memory.id)?.reason ?? "missing_edge",
          epistemicEdgeIds: accessByMemoryId.get(memory.id)?.edgeIds ?? [],
          epistemicDecisions: accessByMemoryId.get(memory.id)?.decisions ?? [],
        },
      })),
      ...threads.map(
        (thread, index) =>
          ({
            kind: "story_projection",
            label: `Open thread ${index + 1}`,
            status: "injected",
            sourceId: ledger!.memory.id,
            sourceCollection: "canonical-memories",
            snippet: thread.text,
            metadata: {
              projectionLevel: "episode",
              openThread: thread.kind,
              epistemicPolicyVersion: accessByMemoryId.has(ledger!.memory.id) ? 1 : undefined,
              epistemicReason: accessByMemoryId.get(ledger!.memory.id)?.reason,
              epistemicEdgeIds: accessByMemoryId.get(ledger!.memory.id)?.edgeIds,
            },
          }) satisfies GenerationContextAttributionItem,
      ),
    ],
  };
}

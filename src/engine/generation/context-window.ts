import type { LlmMessage, LlmToolDefinition } from "../capabilities/llm";
import { MODEL_LISTS } from "../contracts/constants/model-lists";
import { boolish, readNumber, readString } from "./runtime-records";

const DEFAULT_RESPONSE_TOKENS = 4096;
const CONTEXT_SAFETY_TOKENS = 256;
const CHARS_PER_TOKEN = 4;
const MIN_TRUNCATED_BODY_CHARS = 128;
const CONTEXT_OVERFLOW_MESSAGE =
  "Generation context exceeds the selected model window; reduce required prompt sections or choose a larger-context model.";

type ContextConnection = Record<string, unknown> | null | undefined;
type ContextParameters = Record<string, unknown> | null | undefined;
type ContextFitOptions = {
  tools?: LlmToolDefinition[] | null;
};

export type ContextFitDecision = {
  removedMessages: Array<{ contextKind: string; displayName?: string; estimatedTokens: number }>;
  truncatedMessages: Array<{ contextKind: string; removedEstimatedTokens: number }>;
  originalEstimatedTokens: number;
  fittedEstimatedTokens: number;
  inputBudgetTokens: number;
};

export type ContextWindowFit = {
  messages: LlmMessage[];
  parameters: Record<string, unknown>;
  decision: ContextFitDecision | null;
};

interface ContextMessage extends LlmMessage {
  contextKind?: string;
  contextPriority?: number;
  displayName?: string;
}

interface AtomicMessageGroup {
  messages: ContextMessage[];
  indices: number[];
  contextKind: string;
  priority: number;
  toolRoundtrip: boolean;
}

interface PackingOrigin {
  container: ContextMessage;
  containerIndex: number;
  segmentIndex: number | null;
}

export class ContextWindowOverflowError extends Error {
  constructor() {
    super(CONTEXT_OVERFLOW_MESSAGE);
    this.name = "ContextWindowOverflowError";
  }
}

function readPositiveContext(value: unknown): number {
  const parsed = readNumber(value, 0);
  return parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizedKey(value: unknown): string {
  return readString(value).trim().toLowerCase();
}

function knownModelContext(connection: ContextConnection): number {
  const provider = normalizedKey(connection?.provider);
  const model = normalizedKey(connection?.model);
  if (!provider || !model) return 0;

  const modelLists = MODEL_LISTS as Partial<Record<string, Array<{ id: string; name: string; context: number }>>>;
  const known = modelLists[provider]?.find(
    (entry) => normalizedKey(entry.id) === model || normalizedKey(entry.name) === model,
  );
  return readPositiveContext(known?.context);
}

function minPositiveContext(...limits: number[]): number {
  let resolved = 0;
  for (const limit of limits) {
    if (limit <= 0) continue;
    resolved = resolved > 0 ? Math.min(resolved, limit) : limit;
  }
  return resolved;
}

export function effectiveMaxContext(connection: ContextConnection, parameters: ContextParameters): number {
  const knownContext = knownModelContext(connection);
  const parameterContext = boolish(parameters?.useMaxContext, false)
    ? knownContext
    : readPositiveContext(parameters?.maxContext);
  return minPositiveContext(readPositiveContext(connection?.maxContext), knownContext, parameterContext);
}

export function estimateLlmMessageTokens(message: LlmMessage): number {
  const contentTokens = Math.ceil((message.content?.length ?? 0) / CHARS_PER_TOKEN);
  const imageTokens = (message.images?.length ?? 0) * 512;
  const toolTokens = message.tool_calls ? Math.ceil(JSON.stringify(message.tool_calls).length / CHARS_PER_TOKEN) : 0;
  return Math.max(1, contentTokens + imageTokens + toolTokens + 8);
}

function estimatedTokens(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => total + estimateLlmMessageTokens(message), 0);
}

function estimatedToolDefinitionTokens(tools: LlmToolDefinition[] | null | undefined): number {
  if (!tools?.length) return 0;
  return Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + tools.length * 8;
}

function contextKind(message: ContextMessage): string {
  return typeof message.contextKind === "string" && message.contextKind.trim() ? message.contextKind.trim() : "unknown";
}

function defaultPriority(kind: string): number {
  switch (kind) {
    case "summary":
    case "canonical_memory":
      return 700;
    case "memory":
    case "memory_recall":
      return 650;
    case "lorebook":
      return 600;
    case "history":
      return 500;
    case "injection":
    case "optional":
      return 300;
    default:
      return 1_000;
  }
}

function messagePriority(message: ContextMessage): number {
  return Number.isFinite(message.contextPriority)
    ? Number(message.contextPriority)
    : defaultPriority(contextKind(message));
}

function isToolCallMessage(message: ContextMessage): boolean {
  return message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

/** Groups provider-sensitive tool roundtrips and complete dialogue exchanges without changing their order. */
export function groupContextMessages(messages: LlmMessage[]): AtomicMessageGroup[] {
  const source = messages as ContextMessage[];
  const groups: AtomicMessageGroup[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (isToolCallMessage(current)) {
      const groupMessages = [current];
      const indices = [index];
      let cursor = index + 1;
      while (cursor < source.length && source[cursor]!.role === "tool") {
        groupMessages.push(source[cursor]!);
        indices.push(cursor);
        cursor += 1;
      }
      groups.push({
        messages: groupMessages,
        indices,
        contextKind: contextKind(current),
        priority: Math.max(...groupMessages.map(messagePriority)),
        toolRoundtrip: true,
      });
      index = cursor;
      continue;
    }

    if (contextKind(current) === "history" && current.role === "user") {
      const groupMessages = [current];
      const indices = [index];
      const next = source[index + 1];
      if (next && contextKind(next) === "history" && next.role === "assistant" && !isToolCallMessage(next)) {
        groupMessages.push(next);
        indices.push(index + 1);
      }
      groups.push({
        messages: groupMessages,
        indices,
        contextKind: "history",
        priority: Math.max(...groupMessages.map(messagePriority)),
        toolRoundtrip: false,
      });
      index += groupMessages.length;
      continue;
    }

    groups.push({
      messages: [current],
      indices: [index],
      contextKind: contextKind(current),
      priority: messagePriority(current),
      toolRoundtrip: current.role === "tool",
    });
    index += 1;
  }
  return groups;
}

function groupTokens(group: AtomicMessageGroup): number {
  return estimatedTokens(group.messages);
}

function outputFloor(maxContext: number, requestedMaxTokens: number): number {
  return Math.min(requestedMaxTokens, Math.max(256, Math.floor(maxContext * 0.08)));
}

function optionalKind(kind: string): boolean {
  return [
    "summary",
    "canonical_memory",
    "memory",
    "memory_recall",
    "lorebook",
    "history",
    "injection",
    "optional",
  ].includes(kind);
}

function truncatableKind(kind: string): boolean {
  return ["summary", "canonical_memory", "memory", "memory_recall", "lorebook", "injection", "optional"].includes(kind);
}

function truncatedMessageToBudget(message: ContextMessage, availableTokens: number): ContextMessage | null {
  if (availableTokens <= 8 || message.images?.length || message.tool_calls || message.tool_call_id) return null;
  const paragraphs = message.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) return null;

  let retained = "";
  for (const paragraph of paragraphs) {
    const candidate = retained ? `${retained}\n\n${paragraph}` : paragraph;
    if (
      candidate.length < MIN_TRUNCATED_BODY_CHARS ||
      estimateLlmMessageTokens({ ...message, content: candidate }) <= availableTokens
    ) {
      retained = candidate;
      continue;
    }
    break;
  }
  if (retained.length < MIN_TRUNCATED_BODY_CHARS || retained.length >= message.content.length) return null;
  const result = { ...message, content: retained };
  return estimateLlmMessageTokens(result) <= availableTokens ? result : null;
}

function removedMessageDecision(message: ContextMessage) {
  return {
    contextKind: contextKind(message),
    displayName: message.displayName,
    estimatedTokens: estimateLlmMessageTokens(message),
  };
}

function expandPackingMessages(messages: LlmMessage[]): {
  messages: ContextMessage[];
  origins: Map<ContextMessage, PackingOrigin>;
} {
  const expanded: ContextMessage[] = [];
  const origins = new Map<ContextMessage, PackingOrigin>();
  (messages as ContextMessage[]).forEach((container, containerIndex) => {
    if (!container.contextSegments?.length) {
      expanded.push(container);
      origins.set(container, { container, containerIndex, segmentIndex: null });
      return;
    }
    container.contextSegments.forEach((segment, segmentIndex) => {
      const message: ContextMessage = {
        role: segment.role ?? container.role,
        content: segment.content,
        ...(segment.contextKind ? { contextKind: segment.contextKind } : {}),
        ...(segment.contextPriority != null ? { contextPriority: segment.contextPriority } : {}),
        ...(segment.displayName ? { displayName: segment.displayName } : {}),
      };
      expanded.push(message);
      origins.set(message, { container, containerIndex, segmentIndex });
    });
  });
  return { messages: expanded, origins };
}

function rebuildPackedMessages(
  source: LlmMessage[],
  selectedMessages: ContextMessage[],
  origins: Map<ContextMessage, PackingOrigin>,
): LlmMessage[] {
  const selectedByContainer = new Map<number, ContextMessage[]>();
  for (const message of selectedMessages) {
    const origin = origins.get(message);
    if (!origin) continue;
    const list = selectedByContainer.get(origin.containerIndex) ?? [];
    list.push(message);
    selectedByContainer.set(origin.containerIndex, list);
  }

  const result: LlmMessage[] = [];
  source.forEach((rawContainer, containerIndex) => {
    const container = rawContainer as ContextMessage;
    const selected = selectedByContainer.get(containerIndex) ?? [];
    if (selected.length === 0) return;
    if (!container.contextSegments?.length) {
      result.push(selected[0]!);
      return;
    }
    if (
      selected.length === container.contextSegments.length &&
      selected.every((message, index) => message.content === container.contextSegments![index]!.content)
    ) {
      result.push(container);
      return;
    }
    const segments = selected.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.contextKind ? { contextKind: message.contextKind } : {}),
      ...(message.contextPriority != null ? { contextPriority: message.contextPriority } : {}),
      ...(message.displayName ? { displayName: message.displayName } : {}),
    }));
    result.push({
      ...container,
      content: segments.map((segment) => segment.content).join("\n\n"),
      contextSegments: segments,
    });
  });
  return result;
}

export function fitLlmRequestToContextWindow(
  messages: LlmMessage[],
  parameters: Record<string, unknown>,
  connection?: Record<string, unknown> | null,
  options: ContextFitOptions = {},
): ContextWindowFit {
  const maxContext = effectiveMaxContext(connection, parameters);
  if (maxContext <= 0) return { messages, parameters, decision: null };

  const requestedMaxTokens = Math.max(1, Math.trunc(readNumber(parameters.maxTokens, DEFAULT_RESPONSE_TOKENS)));
  const toolDefinitionTokens = estimatedToolDefinitionTokens(options.tools);
  const originalEstimatedTokens = estimatedTokens(messages);
  if (originalEstimatedTokens + requestedMaxTokens + CONTEXT_SAFETY_TOKENS + toolDefinitionTokens <= maxContext) {
    return { messages, parameters, decision: null };
  }

  const minimumOutputTokens = outputFloor(maxContext, requestedMaxTokens);
  const inputBudgetTokens = maxContext - CONTEXT_SAFETY_TOKENS - toolDefinitionTokens - minimumOutputTokens;
  if (inputBudgetTokens < 1) throw new ContextWindowOverflowError();

  const expanded = expandPackingMessages(messages);
  const groups = groupContextMessages(expanded.messages);
  const historyGroups = groups.filter((group) => group.contextKind === "history" && !group.toolRoundtrip);
  const newestHistoryGroups = new Set(historyGroups.slice(-2));
  const lastToolRoundtrip = [...groups].reverse().find((group) => group.toolRoundtrip);
  const laterNonToolHistory = lastToolRoundtrip
    ? groups.some(
        (group) =>
          group.indices[0]! > lastToolRoundtrip.indices[lastToolRoundtrip.indices.length - 1]! &&
          group.contextKind === "history" &&
          !group.toolRoundtrip,
      )
    : false;

  const required = groups.filter(
    (group) =>
      !optionalKind(group.contextKind) ||
      newestHistoryGroups.has(group) ||
      (group === lastToolRoundtrip && !laterNonToolHistory),
  );
  let usedTokens = required.reduce((total, group) => total + groupTokens(group), 0);
  if (usedTokens > inputBudgetTokens) throw new ContextWindowOverflowError();
  // Preserve the requested response capacity whenever required context allows it.
  // Only required context may spend into the space between the requested output
  // reserve and the hard output floor; optional context never does.
  const requestedOutputInputBudget = maxContext - CONTEXT_SAFETY_TOKENS - toolDefinitionTokens - requestedMaxTokens;
  const packingBudgetTokens = Math.min(
    inputBudgetTokens,
    Math.max(usedTokens, Math.max(0, requestedOutputInputBudget)),
  );

  const selected = new Map<AtomicMessageGroup, ContextMessage[]>();
  for (const group of required) selected.set(group, group.messages);
  const removedMessages: ContextFitDecision["removedMessages"] = [];
  const truncatedMessages: ContextFitDecision["truncatedMessages"] = [];
  const optional = groups
    .filter((group) => !selected.has(group))
    .sort((left, right) => right.priority - left.priority || right.indices[0]! - left.indices[0]!);

  for (const group of optional) {
    const tokens = groupTokens(group);
    if (usedTokens + tokens <= packingBudgetTokens) {
      selected.set(group, group.messages);
      usedTokens += tokens;
      continue;
    }

    const availableTokens = packingBudgetTokens - usedTokens;
    const onlyMessage = group.messages.length === 1 ? group.messages[0] : undefined;
    const truncated =
      onlyMessage && truncatableKind(group.contextKind) ? truncatedMessageToBudget(onlyMessage, availableTokens) : null;
    if (truncated) {
      const origin = expanded.origins.get(onlyMessage!);
      if (origin) expanded.origins.set(truncated, origin);
      selected.set(group, [truncated]);
      const retainedTokens = estimateLlmMessageTokens(truncated);
      usedTokens += retainedTokens;
      truncatedMessages.push({
        contextKind: group.contextKind,
        removedEstimatedTokens: Math.max(0, tokens - retainedTokens),
      });
      continue;
    }

    removedMessages.push(...group.messages.map(removedMessageDecision));
  }

  const selectedMessages = groups.flatMap((group) => selected.get(group) ?? []);
  const fittedMessages = rebuildPackedMessages(messages, selectedMessages, expanded.origins);
  const fittedEstimatedTokens = estimatedTokens(fittedMessages);
  const availableOutputTokens = maxContext - CONTEXT_SAFETY_TOKENS - toolDefinitionTokens - fittedEstimatedTokens;
  if (availableOutputTokens < minimumOutputTokens) throw new ContextWindowOverflowError();
  const fittedMaxTokens = Math.min(requestedMaxTokens, availableOutputTokens);
  const fittedParameters =
    fittedMaxTokens === requestedMaxTokens ? parameters : { ...parameters, maxTokens: fittedMaxTokens };

  return {
    messages: fittedMessages,
    parameters: fittedParameters,
    decision: {
      removedMessages,
      truncatedMessages,
      originalEstimatedTokens,
      fittedEstimatedTokens,
      inputBudgetTokens,
    },
  };
}

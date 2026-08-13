import { boolish, hiddenFromAi, parseRecord, readString, type JsonRecord } from "./runtime-records";

interface FocusableConversationCharacter {
  id: string;
  name: string;
  description: string;
  personality?: string;
  scenario?: string;
  creatorNotes?: string;
  publicProfile?: unknown;
  systemPrompt?: string;
  backstory?: string;
  appearance?: string;
  mesExample?: string;
  firstMes?: string;
  postHistoryInstructions?: string;
  behavioralInterpretation?: string;
  memories?: string[];
}

export interface ConversationContextFocus<T extends FocusableConversationCharacter> {
  characters: T[];
  historyLimit: number;
  includeAssistantHistory: boolean;
  summaryMaxContext: number;
  memoryRecallTokenBudget: number;
  canonicalMemoryMaxContext: number;
}

const ASSISTANT_REPLY_THRESHOLD = 20;
const HISTORY_MESSAGE_LIMIT = 5;
const SUMMARY_MAX_CONTEXT = 9_600;
const MEMORY_RECALL_TOKEN_BUDGET = 512;
const CANONICAL_MEMORY_MAX_CONTEXT = 4_000;
const COMPACTION_MARKER = "\n...\n";
const HIDDEN_COMMAND_RE = /\[(?:cross_post|memory|scene|schedule_update|selfie|spotify)\b[^\]]*\]/i;
const CONVERSATION_VOICE_EXAMPLES_OPEN = "<conversation_voice_examples>";

export function isFocusedConversationVoiceExamples(value: string | undefined): boolean {
  return readString(value).trimStart().startsWith(CONVERSATION_VOICE_EXAMPLES_OPEN);
}

function activeConversationSegment(messages: JsonRecord[]): JsonRecord[] {
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (boolish(parseRecord(messages[index]!.extra).isConversationStart, false)) {
      startIndex = index;
      break;
    }
  }
  return startIndex > 0 ? messages.slice(startIndex) : messages;
}

function visibleAssistantReplyCount(messages: JsonRecord[]): number {
  return activeConversationSegment(messages).filter(
    (message) => !hiddenFromAi(message) && readString(message.role) === "assistant",
  ).length;
}

function boundarySlice(text: string, maxChars: number, fromEnd: boolean): string {
  const source = fromEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
  const whitespace = fromEnd ? source.search(/\s/) : Math.max(source.lastIndexOf(" "), source.lastIndexOf("\n"));
  if (whitespace < 0) return source.trim();
  const bounded = fromEnd ? source.slice(whitespace + 1) : source.slice(0, whitespace);
  return (bounded.length >= Math.floor(maxChars * 0.6) ? bounded : source).trim();
}

function compactText(value: string | undefined, maxChars: number): string | undefined {
  const text = readString(value).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return undefined;
  if (text.length <= maxChars) return text;
  const available = Math.max(2, maxChars - COMPACTION_MARKER.length);
  const headChars = Math.ceil(available * 0.58);
  const tailChars = available - headChars;
  return `${boundarySlice(text, headChars, false)}${COMPACTION_MARKER}${boundarySlice(text, tailChars, true)}`;
}

function compactMemories(memories: string[] | undefined): string[] | undefined {
  if (!memories?.length) return undefined;
  const compact = compactText(memories.join("\n"), 400);
  return compact ? [compact] : undefined;
}

function stripExampleActions(value: string): string {
  return value.replace(/\*[^*]*\*/gs, " ").replace(/\s+/g, " ").trim();
}

function cardConversationVoiceExamples(
  value: string | undefined,
  characterName: string,
  userName: string,
): string[] {
  const blocks = readString(value)
    .split(/<START>/gi)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks
    .flatMap((block) => {
      const userMatch = /\{\{user\}\}\s*:/i.exec(block);
      const characterMatch = /\{\{char\}\}\s*:/i.exec(block);
      if (!userMatch || !characterMatch || characterMatch.index <= userMatch.index) return [];
      const userText = stripExampleActions(
        block.slice(userMatch.index + userMatch[0].length, characterMatch.index),
      );
      const characterSection = block.slice(characterMatch.index + characterMatch[0].length);
      const spokenLines = Array.from(characterSection.matchAll(/"([^"]+)"|“([^”]+)”/g), (match) =>
        readString(match[1] ?? match[2]).trim(),
      ).filter(Boolean);
      const user = compactText(userText, 220);
      const assistant = compactText(spokenLines.join(" "), 320);
      return user && assistant ? [`${userName}: ${user}\n${characterName}: ${assistant}`] : [];
    })
    .slice(-2);
}

function historicalConversationVoiceExamples(
  messages: JsonRecord[],
  targetCharacterId: string,
  characterName: string,
  userName: string,
  limit: number,
): string[] {
  const examples: string[] = [];
  let latestUser = "";
  let sawUser = false;
  for (const message of activeConversationSegment(messages)) {
    if (hiddenFromAi(message)) continue;
    const role = readString(message.role);
    const content = readString(message.content).trim();
    if (!content) continue;
    if (role === "user") {
      latestUser = content;
      sawUser = true;
      continue;
    }
    if (role !== "assistant" || !sawUser || examples.length >= limit) continue;
    const characterId = readString(message.characterId).trim();
    if (characterId && characterId !== targetCharacterId) continue;
    if (HIDDEN_COMMAND_RE.test(content) || /\*[^*]+\*/s.test(content)) continue;
    const user = compactText(latestUser, 180);
    const assistant = compactText(content, 260);
    if (!user || !assistant) continue;
    examples.push(`${userName}: ${user}\n${characterName}: ${assistant}`);
  }
  return examples;
}

function conversationVoiceExamples(
  messages: JsonRecord[],
  character: FocusableConversationCharacter,
  userName: string,
): string | undefined {
  const cardExamples = cardConversationVoiceExamples(character.mesExample, character.name, userName);
  const historicalExamples = historicalConversationVoiceExamples(
    messages,
    character.id,
    character.name,
    userName,
    Math.max(0, 2 - cardExamples.length),
  );
  const examples = [...cardExamples, ...historicalExamples].slice(0, 2);
  if (examples.length === 0) return undefined;
  return [
    CONVERSATION_VOICE_EXAMPLES_OPEN,
    `Make each reply identifiable in isolation as ${character.name}. Speak from ${character.name}'s personal stakes and worldview, never as a neutral commentator. Match the examples' diction, casing, cadence, and degree of formality without quoting them.`,
    ...examples,
    "</conversation_voice_examples>",
  ].join("\n\n");
}

function focusedCharacter<T extends FocusableConversationCharacter>(
  character: T,
  messages: JsonRecord[],
  targetCharacterId: string,
  userName: string,
): T {
  const isTarget = character.id === targetCharacterId;
  return {
    ...character,
    description: compactText(character.description, 450) ?? "",
    personality: compactText(character.personality, 320),
    scenario: compactText(character.scenario, 240),
    backstory: compactText(character.backstory, 200),
    systemPrompt: compactText(character.systemPrompt, 650),
    postHistoryInstructions: compactText(character.postHistoryInstructions, 400),
    memories: compactMemories(character.memories),
    mesExample: isTarget
      ? isFocusedConversationVoiceExamples(character.mesExample)
        ? character.mesExample
        : conversationVoiceExamples(messages, character, userName)
      : undefined,
    firstMes: undefined,
    appearance: undefined,
    creatorNotes: undefined,
    publicProfile: undefined,
    behavioralInterpretation: undefined,
  };
}

export function conversationContextFocus<T extends FocusableConversationCharacter>(input: {
  mode: string;
  impersonate: boolean;
  characters: T[];
  targetCharacterId?: string | null;
  storedMessages: JsonRecord[];
  userName?: string | null;
}): ConversationContextFocus<T> | null {
  if (input.mode !== "conversation" || input.impersonate) return null;
  const targetCharacterId =
    input.characters.length === 1 ? input.characters[0]!.id : readString(input.targetCharacterId).trim();
  if (!targetCharacterId || !input.characters.some((character) => character.id === targetCharacterId)) return null;
  if (visibleAssistantReplyCount(input.storedMessages) < ASSISTANT_REPLY_THRESHOLD) return null;

  const userName = readString(input.userName).trim() || "User";
  return {
    characters: input.characters.map((character) =>
      focusedCharacter(character, input.storedMessages, targetCharacterId, userName),
    ),
    historyLimit: HISTORY_MESSAGE_LIMIT,
    includeAssistantHistory: true,
    summaryMaxContext: SUMMARY_MAX_CONTEXT,
    memoryRecallTokenBudget: MEMORY_RECALL_TOKEN_BUDGET,
    canonicalMemoryMaxContext: CANONICAL_MEMORY_MAX_CONTEXT,
  };
}

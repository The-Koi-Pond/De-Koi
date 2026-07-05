import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type {
  CanonicalMemoryInput,
  CanonicalMemoryPatch,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
} from "../contracts/types/memory";
import { isRecord, parseRecord, readString } from "./runtime-records";

type AutomaticMemoryCategory =
  | "stable_fact"
  | "relationship_change"
  | "scene_event"
  | "preference"
  | "promise"
  | "plot_state"
  | "contradiction";

type SavedAssistantMessage = {
  id?: unknown;
  chatId?: unknown;
  role?: unknown;
  characterId?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

type AutomaticMemoryCandidate = {
  category?: unknown;
  content?: unknown;
  confidence?: unknown;
  uncertain?: unknown;
  title?: unknown;
  tags?: unknown;
  characterId?: unknown;
  supersedesMemoryId?: unknown;
  status?: unknown;
  payload?: unknown;
};

export type AutomaticMemoryCaptureInput = {
  storage: StorageGateway;
  llm: LlmGateway;
  chat: Record<string, unknown>;
  message: SavedAssistantMessage;
  connectionId?: string | null;
  model?: string | null;
  signal?: AbortSignal;
};

const CATEGORY_TO_KIND: Record<AutomaticMemoryCategory, MemoryKind> = {
  stable_fact: "fact",
  relationship_change: "relationship_state",
  scene_event: "scene_event",
  preference: "preference",
  promise: "promise",
  plot_state: "plot_state",
  contradiction: "contradiction",
};

const CAPTURE_CATEGORIES = Object.keys(CATEGORY_TO_KIND) as AutomaticMemoryCategory[];
const ACTIVE_CONFIDENCE_THRESHOLD = 0.7;
const MAX_CAPTURED_MEMORIES = 12;

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry).trim()).filter((entry) => entry.length > 0)
    : [];
}

function normalizedCategory(value: unknown): AutomaticMemoryCategory | null {
  const category = readString(value).trim();
  return CAPTURE_CATEGORIES.includes(category as AutomaticMemoryCategory) ? (category as AutomaticMemoryCategory) : null;
}

function normalizedConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function normalizedStatus(candidate: AutomaticMemoryCandidate, confidence: number): MemoryStatus {
  const requested = readString(candidate.status).trim();
  if (requested === "active" || requested === "pinned" || requested === "stale") return requested;
  return candidate.uncertain === true || confidence < ACTIVE_CONFIDENCE_THRESHOLD ? "stale" : "active";
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const body = fenced || trimmed;
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) return parsed;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(body.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    }
  }
  throw new Error("Automatic memory extraction did not return a JSON object");
}

function extractionPrompt(args: {
  chatMode: string;
  sceneId: string | null;
  characterId: string | null;
  content: string;
}): string {
  return [
    "Extract durable memory candidates from this saved assistant turn for De-Koi.",
    'Return JSON only: {"memories":[...]}',
    "Allowed categories: stable_fact, relationship_change, scene_event, preference, promise, plot_state, contradiction.",
    "Use confidence 0..1. Mark uncertain memories with low confidence or uncertain:true.",
    "If a contradiction supersedes a known memory, include supersedesMemoryId when available.",
    `Mode: ${args.chatMode || "conversation"}`,
    `Scene id: ${args.sceneId ?? ""}`,
    `Character id: ${args.characterId ?? ""}`,
    "Assistant turn:",
    args.content,
  ].join("\n");
}

function sceneIdForChat(chat: Record<string, unknown>, chatId: string): string | null {
  const metadata = parseRecord(chat.metadata);
  return (
    readString(metadata.sceneChatId).trim() ||
    readString(metadata.activeSceneChatId).trim() ||
    (readString(metadata.sceneStatus).trim() === "active" ? chatId : "") ||
    null
  );
}

function scopeForCandidate(args: {
  chat: Record<string, unknown>;
  chatId: string;
  mode: string;
  sceneId: string | null;
}): MemoryScope {
  const metadata = parseRecord(args.chat.metadata);
  if (args.mode === "agent") {
    return {
      kind: "agent",
      id: readString(metadata.agentType).trim() || readString(metadata.agentId).trim() || args.chatId,
    };
  }
  if ((args.mode === "roleplay" || args.mode === "visual_novel") && args.sceneId) {
    return { kind: "scene", id: args.sceneId };
  }
  return { kind: "chat", id: args.chatId };
}

function automaticMemoryInput(args: {
  chat: Record<string, unknown>;
  message: SavedAssistantMessage;
  candidate: AutomaticMemoryCandidate;
  category: AutomaticMemoryCategory;
  sceneId: string | null;
  mode: string;
}): CanonicalMemoryInput | null {
  const content = readString(args.candidate.content).trim();
  const messageId = readString(args.message.id).trim();
  const chatId = readString(args.message.chatId).trim() || readString(args.chat.id).trim();
  if (!content || !messageId || !chatId) return null;
  const confidence = normalizedConfidence(args.candidate.confidence);
  const characterId = readString(args.candidate.characterId).trim() || readString(args.message.characterId).trim();
  const payload = parseRecord(args.candidate.payload);
  return {
    kind: CATEGORY_TO_KIND[args.category],
    status: normalizedStatus(args.candidate, confidence),
    scope: scopeForCandidate({
      chat: args.chat,
      chatId,
      mode: args.mode,
      sceneId: args.sceneId,
    }),
    content,
    confidence,
    title: readString(args.candidate.title).trim() || null,
    tags: Array.from(new Set([args.category, ...readStringArray(args.candidate.tags)])),
    provenance: {
      sourceChatId: chatId,
      messageIds: [messageId],
      sceneId: args.sceneId,
      characterId: characterId || null,
      timestamp: readString(args.message.createdAt).trim() || null,
    },
    supersedesMemoryId: readString(args.candidate.supersedesMemoryId).trim() || null,
    payload: {
      ...payload,
      category: args.category,
      automatic: true,
      captureVersion: 1,
      mode: args.mode || "conversation",
    },
  };
}

async function rebuildTouchedIndexes(storage: StorageGateway, scopes: Map<string, MemoryScope>): Promise<void> {
  if (!storage.rebuildMemoryIndex) return;
  await Promise.all(
    [...scopes.values()].map(async (scope) => {
      try {
        await storage.rebuildMemoryIndex?.({ scope });
      } catch (error) {
        console.warn("[generation] automatic memory index refresh failed", error);
      }
    }),
  );
}

export async function captureAutomaticMemoriesAfterAssistantTurn(input: AutomaticMemoryCaptureInput): Promise<void> {
  const chatId = readString(input.chat.id).trim() || readString(input.message.chatId).trim();
  const messageId = readString(input.message.id).trim();
  const role = readString(input.message.role).trim();
  const content = readString(input.message.content).trim();
  if (!chatId || !messageId || role !== "assistant" || !content || !input.storage.createMemory) return;

  const mode = readString(input.chat.mode || input.chat.chatMode).trim() || "conversation";
  const sceneId = sceneIdForChat(input.chat, chatId);
  const characterId = readString(input.message.characterId).trim() || null;
  const raw = await input.llm.complete(
    {
      connectionId: input.connectionId,
      model: input.model ?? undefined,
      messages: [
        {
          role: "system",
          content:
            "You extract durable chat memories. You do not summarize every turn. You return strict JSON only.",
        },
        {
          role: "user",
          content: extractionPrompt({ chatMode: mode, sceneId, characterId, content }),
        },
      ],
      parameters: { temperature: 0, maxTokens: 900 },
    },
    input.signal,
  );
  const parsed = extractJsonObject(raw);
  const candidates = Array.isArray(parsed.memories)
    ? parsed.memories.filter(isRecord).slice(0, MAX_CAPTURED_MEMORIES)
    : [];
  const touchedScopes = new Map<string, MemoryScope>();

  for (const candidate of candidates as AutomaticMemoryCandidate[]) {
    const category = normalizedCategory(candidate.category);
    if (!category) continue;
    const memoryInput = automaticMemoryInput({
      chat: input.chat,
      message: input.message,
      candidate,
      category,
      sceneId,
      mode,
    });
    if (!memoryInput) continue;
    const created = await input.storage.createMemory(memoryInput);
    touchedScopes.set(`${created.scope.kind}:${created.scope.id}`, created.scope);
    const supersedesMemoryId = readString(memoryInput.supersedesMemoryId).trim();
    if (supersedesMemoryId && input.storage.updateMemory) {
      const patch: CanonicalMemoryPatch = {
        status: "superseded",
        supersededByMemoryId: created.id,
      };
      await input.storage.updateMemory(supersedesMemoryId, patch);
    }
  }

  await rebuildTouchedIndexes(input.storage, touchedScopes);
}

export async function captureAutomaticMemoriesSafely(input: AutomaticMemoryCaptureInput): Promise<void> {
  try {
    await captureAutomaticMemoriesAfterAssistantTurn(input);
  } catch (error) {
    console.warn("[generation] automatic memory capture failed", error);
  }
}
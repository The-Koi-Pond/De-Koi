import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { createFakeBackgroundJobs } from "./background-job-queue.fake";
import { subscribePostReplyRecoveries, type PostReplyRecovery } from "./post-reply-recoveries";
import { resumeQueuedPostReplyAgents, retryGenerationAgents } from "./start-generation";

type Row = Record<string, unknown>;

const CONNECTION = { id: "conn-1", provider: "test-provider", model: "main-model" };
const CARD_UPDATE = {
  characterId: "char-1",
  action: "update",
  field: "description",
  oldText: "Mira keeps the lantern.",
  newText: "Mira keeps the lantern and the harbor key.",
  reason: "She took the key in this reply.",
};
const AGENT_REPLIES: Record<string, unknown> = {
  "model-background": {
    chosen: null,
    generate: { location: "Rainy harbor", prompt: "Wide shot of a rainy harbor at dusk, empty.", reason: "New place" },
  },
  "model-card-evolution-auditor": { updates: [CARD_UPDATE, { ...CARD_UPDATE, field: "nonsense" }] },
};

function agentRow(type: string, overrides: Row = {}): Row {
  return { id: `agent-${type}`, type, name: type, enabled: true, model: `model-${type}`, ...overrides };
}

const AGENTS = [
  agentRow("background", { settings: { imageConnectionId: "image-conn" } }),
  agentRow("card-evolution-auditor"),
];

function message(id: string, role: string, minute: number, extra: Row = {}): Row {
  const at = `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return { id, chatId: "chat-1", role, content: `${role} ${id}`, createdAt: at, updatedAt: at, extra };
}

/** A chat whose last reply was saved by a turn whose tab closed before its helpers ran. */
function recoveredChat(metadata: Row = {}) {
  const chat: Row = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: CONNECTION.id,
    characterIds: ["char-1"],
    metadata: { enableAgents: true, activeAgentIds: AGENTS.map((agent) => agent.type), ...metadata },
  };
  const character = { id: "char-1", name: "Mira", data: { name: "Mira", description: "Mira keeps the lantern." } };
  const messages = [
    message("user-1", "user", 1),
    message("assistant-1", "assistant", 2, { postReplyAgents: { turnId: "reply-1", status: "pending" } }),
  ];
  const agentRuns: Row[] = [];
  const metadataPatches: Row[] = [];
  const findMessage = (id: string) => messages.find((row) => row.id === id) ?? null;
  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return AGENTS as T[];
      if (entity === "connections") return [CONNECTION] as T[];
      if (entity === "agent-runs") return agentRuns as T[];
      if (entity === "characters") return [character] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === CONNECTION.id) return CONNECTION as T;
      if (entity === "agents") return (AGENTS.find((agent) => agent.id === id) ?? null) as T | null;
      if (entity === "characters" && id === character.id) return character as T;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Row): Promise<T> {
      const row = { id: `${entity}-${agentRuns.length + 1}`, ...value };
      if (entity === "agent-runs") agentRuns.push(row);
      return row as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(_chatId: string, options?: { before?: unknown }): Promise<T[]> {
      if (!options?.before) return messages as T[];
      return messages.filter((row) => `${row.createdAt}|${row.id}` < String(options.before)) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return findMessage(messageId) as T | null;
    },
    async createChatMessage<T = unknown>() {
      return {} as T;
    },
    async updateChatMessage<T = unknown>() {
      return {} as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Row): Promise<T> {
      const row = findMessage(messageId)!;
      row.extra = { ...(row.extra as Row), ...patch };
      return row as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>(_chatId: string, patch: Row): Promise<T> {
      metadataPatches.push(patch);
      chat.metadata = { ...(chat.metadata as Row), ...patch };
      return chat as T;
    },
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories<T = unknown>() {
      return [] as T[];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return {} as T;
    },
    async listLorebookEntries() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  };
  return { chat, storage, agentRuns, metadataPatches };
}

const llm: LlmGateway = {
  complete: vi.fn(async () => ""),
  async *stream(request: LlmRequest) {
    yield { type: "token", text: JSON.stringify(AGENT_REPLIES[String(request.model)] ?? {}) };
  },
  listModels: vi.fn(async () => []),
};

function imageAndUpload() {
  const generate = vi.fn(async () => ({ base64: "iVBORw0KGgo=", mimeType: "image/png", ext: "png" }));
  const uploadBackground = vi.fn(async (image: { filename: string }) => ({ filename: image.filename }));
  return {
    generate,
    uploadBackground,
    integrations: { image: { generate } } as unknown as IntegrationGateway,
    visuals: { uploadBackground } as unknown as VisualAssetGateway,
  };
}

async function recover(storage: StorageGateway, integrations: IntegrationGateway, visuals: VisualAssetGateway) {
  const fake = createFakeBackgroundJobs();
  const recoveries: PostReplyRecovery[] = [];
  const unsubscribe = subscribePostReplyRecoveries((recovery) => recoveries.push(recovery));
  await fake.gateway.enqueue({
    queue: "post-reply-agents",
    key: "reply-1",
    chatId: "chat-1",
    payload: { turnId: "reply-1", connectionId: CONNECTION.id, regeneration: false },
  });
  resumeQueuedPostReplyAgents({ storage: { ...storage, backgroundJobs: fake.gateway }, llm, integrations, visuals });
  await vi.waitFor(() => expect(fake.finished).toHaveLength(1));
  unsubscribe();
  return { finished: fake.finished, recoveries };
}

const auditorRun = (runs: Row[]) => runs.find((run) => run.agentType === "card-evolution-auditor");

describe("a recovered run applies what a live tab would have", () => {
  afterEach(() => vi.restoreAllMocks());

  it("generates the background the Background agent asked for and saves it as the chat's background", async () => {
    const { storage, metadataPatches } = recoveredChat();
    const { generate, uploadBackground, integrations, visuals } = imageAndUpload();

    const { finished } = await recover(storage, integrations, visuals);

    expect(finished).toEqual([{ jobId: "post-reply-agents:reply-1", outcome: "done", error: null }]);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "image-conn", kind: "background", width: 1280, height: 720 }),
    );
    expect(uploadBackground).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "rainy-harbor.png", dataUrl: expect.stringMatching(/^data:image\/png/) }),
    );
    expect(metadataPatches).toEqual([{ background: "rainy-harbor.png" }]);
  });

  it("leaves a chat that already has a background alone", async () => {
    const { storage, metadataPatches } = recoveredChat({ background: "library/castle.png" });
    const { generate, integrations, visuals } = imageAndUpload();

    await recover(storage, integrations, visuals);

    expect(generate).not.toHaveBeenCalled();
    expect(metadataPatches).toEqual([]);
  });

  it("still finishes the recovery when the background can't be generated", async () => {
    const { storage, agentRuns } = recoveredChat();
    const { integrations, visuals } = imageAndUpload();
    vi.mocked(integrations.image.generate).mockRejectedValueOnce(new Error("image provider down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { finished } = await recover(storage, integrations, visuals);

    expect(finished).toEqual([{ jobId: "post-reply-agents:reply-1", outcome: "done", error: null }]);
    expect(auditorRun(agentRuns)).toBeDefined();
  });

  it("stores its card updates for review and says how many are waiting", async () => {
    const { storage, agentRuns } = recoveredChat();
    const { integrations, visuals } = imageAndUpload();

    const { recoveries } = await recover(storage, integrations, visuals);

    // Only proposals the review dialog can show are marked; the unusable one is left as it came.
    expect((auditorRun(agentRuns)?.resultData as Row).updates).toEqual([
      { ...CARD_UPDATE, reviewStatus: "pending" },
      { ...CARD_UPDATE, field: "nonsense" },
    ]);
    expect(recoveries).toEqual([{ chatId: "chat-1", messageId: "assistant-1", pendingCardReviews: 1 }]);
  });

  it("does not store a live (manually retried) run's card updates for review; that tab shows them", async () => {
    const { storage, agentRuns, metadataPatches } = recoveredChat();
    const { generate, integrations, visuals } = imageAndUpload();

    await retryGenerationAgents(
      { storage, llm, integrations, visuals },
      {
        chatId: "chat-1",
        agentTypes: ["card-evolution-auditor", "background"],
        options: { forMessageId: "assistant-1" },
      },
    );

    expect((auditorRun(agentRuns)?.resultData as Row).updates).toEqual([
      CARD_UPDATE,
      { ...CARD_UPDATE, field: "nonsense" },
    ]);
    expect(generate).not.toHaveBeenCalled();
    expect(metadataPatches).toEqual([]);
  });
});

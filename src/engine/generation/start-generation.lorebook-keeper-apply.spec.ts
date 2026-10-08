import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { subscribeLorebookKeeperSettlements, type LorebookKeeperSettlement } from "./lorebook-keeper-settlements";
import { retryGenerationAgents } from "./start-generation";

const PROPOSAL = {
  action: "create",
  entryName: "Archivist koi",
  content: "The Archivist koi is two hundred years old.",
  keys: ["Archivist"],
  reason: "New lore from the reply",
};

/** A chat with one assistant reply the Keeper has not processed yet, and one target lorebook. */
function keeperBackfillStorage(metadata: Record<string, unknown>) {
  const created: Array<{ entity: string; value: Record<string, unknown> }> = [];
  const chat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "conn-1",
    characterIds: [],
    metadata: { activeAgentIds: ["lorebook-keeper"], lorebookKeeperTargetLorebookId: "book-1", ...metadata },
  };
  const reply = {
    id: "assistant-1",
    chatId: "chat-1",
    role: "assistant",
    content: "Mirelle says the Archivist koi is two hundred years old.",
    createdAt: "2026-01-01T00:01:00.000Z",
    extra: {},
  };
  const storage = {
    async get(entity: string, id: string) {
      if (entity === "chats" && id === chat.id) return chat;
      if (entity === "connections" && id === "conn-1") return { id: "conn-1", provider: "test", model: "test" };
      return null;
    },
    async list(entity: string) {
      if (entity === "agents") {
        return [{ id: "lorebook-keeper", type: "lorebook-keeper", enabled: true, settings: { runInterval: 1 } }];
      }
      if (entity === "lorebooks") return [{ id: "book-1", name: "Pond lore", enabled: true }];
      return [];
    },
    async listChatMessages() {
      return [reply];
    },
    async create(entity: string, value: Record<string, unknown>) {
      created.push({ entity, value });
      return { id: `${entity}-${created.length}`, ...value };
    },
    async update() {
      return {};
    },
    async delete() {
      return { deleted: false };
    },
    async getChatMessage() {
      return reply;
    },
    async patchChatMessageExtra() {
      return {};
    },
    async listLorebookEntries() {
      return [];
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot() {
      return {};
    },
    async patchChatMetadata() {
      return {};
    },
  };
  return { storage: storage as unknown as StorageGateway, created };
}

const llm: LlmGateway = {
  complete: vi.fn(async () => JSON.stringify({ updates: [PROPOSAL] })),
  async *stream() {
    yield { type: "token", text: JSON.stringify({ updates: [PROPOSAL] }) };
  },
  listModels: vi.fn(async () => []),
};

function runKeeperBackfill(storage: StorageGateway, integrations: IntegrationGateway = {} as IntegrationGateway) {
  return retryGenerationAgents(
    { storage, llm, integrations },
    { chatId: "chat-1", agentTypes: ["lorebook-keeper"], options: { lorebookKeeperBackfill: true } },
  );
}

function storedKeeperProposals(created: Array<{ entity: string; value: Record<string, unknown> }>) {
  const run = created.find((record) => record.entity === "agent-runs" && record.value.agentType === "lorebook-keeper");
  return (run?.value.resultData as { updates?: Array<Record<string, unknown>> } | undefined)?.updates ?? [];
}

describe("retryGenerationAgents Lorebook Keeper backfill proposals", () => {
  const settlements: LorebookKeeperSettlement[] = [];
  const unsubscribe = subscribeLorebookKeeperSettlements((settlement) => settlements.push(settlement));
  afterEach(() => {
    settlements.length = 0;
  });

  it("writes the proposal to the lorebook when review is off, with no tab needed to apply it", async () => {
    const { storage, created } = keeperBackfillStorage({ lorebookKeeperReviewRequired: false });
    const vectorizeEntries = vi.fn(async () => ({}));

    await runKeeperBackfill(storage, { lorebooks: { vectorizeEntries } } as unknown as IntegrationGateway);

    const entries = created.filter((record) => record.entity === "lorebook-entries");
    expect(entries).toEqual([
      {
        entity: "lorebook-entries",
        value: expect.objectContaining({ lorebookId: "book-1", name: "Archivist koi", keys: ["Archivist"] }),
      },
    ]);
    expect(vectorizeEntries).toHaveBeenCalledWith("book-1", [expect.any(String)]);
    // Stored as applied, so the review dialog never offers it again.
    expect(storedKeeperProposals(created)).toEqual([
      expect.objectContaining({ entryName: "Archivist koi", reviewStatus: "applied" }),
    ]);
    expect(settlements).toEqual([{ chatId: "chat-1", applied: 1, pending: 0, lorebookIds: ["book-1"] }]);
  });

  it("stores the proposal as pending review when review is on, without touching the lorebook", async () => {
    const { storage, created } = keeperBackfillStorage({});

    await runKeeperBackfill(storage);

    expect(created.filter((record) => record.entity === "lorebook-entries")).toEqual([]);
    expect(storedKeeperProposals(created)).toEqual([
      expect.objectContaining({ entryName: "Archivist koi", reviewStatus: "pending" }),
    ]);
    expect(settlements).toEqual([{ chatId: "chat-1", applied: 0, pending: 1, lorebookIds: [] }]);
  });

  it("publishes the settlement only after the run is stored", async () => {
    const { storage, created } = keeperBackfillStorage({});
    let runStoredWhenPublished: boolean | null = null;
    const stop = subscribeLorebookKeeperSettlements(() => {
      runStoredWhenPublished = created.some((record) => record.entity === "agent-runs");
    });
    try {
      await runKeeperBackfill(storage);
    } finally {
      stop();
    }
    expect(runStoredWhenPublished).toBe(true);
  });

  afterAll(unsubscribe);
});

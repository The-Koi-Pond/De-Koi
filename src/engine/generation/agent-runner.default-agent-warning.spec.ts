import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { createGenerationAgentRuntime } from "./agent-runner";
import type { JsonRecord } from "./runtime-records";

function recordList<T = JsonRecord>(records: JsonRecord[], options?: StorageListOptions): T[] {
  let rows = [...records];
  if (options?.filters) {
    rows = rows.filter((row) => Object.entries(options.filters ?? {}).every(([key, value]) => row[key] === value));
  }
  return rows as T[];
}

function runtimeStorage(args: { agents: JsonRecord[]; connections: JsonRecord[] }): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "agents") return recordList<T>(args.agents, options);
      if (entity === "connections") return recordList<T>(args.connections, options);
      return [];
    },
    async get() {
      return null;
    },
    async create<T = unknown>() {
      return {} as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages() {
      return [];
    },
    async getChatMessage() {
      return null;
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
    async patchChatMessageExtra<T = unknown>() {
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>() {
      return {} as T;
    },
    async listLorebookEntries() {
      return [];
    },
  } as unknown as StorageGateway;
}

const llm = {
  async *stream() {
    yield { type: "done" };
  },
} as unknown as LlmGateway;

const integrations = {} as IntegrationGateway;

const illustratorLlm = {
  async *stream() {
    yield {
      type: "token",
      text: JSON.stringify({
        shouldGenerate: true,
        prompt: "Mira catches a candle in a moonlit library.",
      }),
    };
    yield { type: "done" };
  },
  async listModels() {
    return [];
  },
} as unknown as LlmGateway;

describe("default agent connection warnings", () => {
  it("includes a connection-scoped dismissal key for the default agent warning", async () => {
    const runtime = await createGenerationAgentRuntime(
      {
        storage: runtimeStorage({
          connections: [
            {
              id: "conn-paid",
              name: "Paid API",
              provider: "openai",
              model: "gpt-paid",
              defaultForAgents: true,
            },
          ],
          agents: [
            { id: "agent-one", type: "custom-one", name: "One", enabled: true },
            { id: "agent-two", type: "custom-two", name: "Two", enabled: true },
          ],
        }),
        llm,
        integrations,
      },
      {
        chat: { id: "chat-1", mode: "roleplay", metadata: {} },
        connection: { id: "chat-conn", name: "Chat", provider: "openai", model: "chat-model" },
        storedMessages: [],
        characters: [],
        persona: null,
        activatedLorebookEntries: [],
        chatSummary: null,
        agentTypes: new Set(["agent-one", "agent-two"]),
      },
    );

    expect(runtime.agentWarnings).toHaveLength(1);
    expect(runtime.agentWarnings[0]).toEqual(
      expect.objectContaining({
        code: "default_agent_connection_active",
        connectionId: "conn-paid",
        connectionName: "Paid API",
        model: "gpt-paid",
        dismissalKey: "default_agent_connection_active:conn-paid",
        agentNames: ["One", "Two"],
      }),
    );
  });

  it("uses the built-in fallback for an explicit Illustrator retry when the stored row is disabled", async () => {
    const runtime = await createGenerationAgentRuntime(
      {
        storage: runtimeStorage({
          connections: [],
          agents: [{ id: "illustrator", type: "illustrator", name: "Illustrator", enabled: false }],
        }),
        llm: illustratorLlm,
        integrations,
      },
      {
        chat: { id: "chat-1", mode: "roleplay", metadata: {} },
        connection: { id: "chat-conn", name: "Chat", provider: "openai", model: "chat-model" },
        storedMessages: [{ id: "user-1", role: "user", content: "I reach for the falling candle." }],
        characters: [],
        persona: null,
        activatedLorebookEntries: [],
        chatSummary: null,
        agentTypes: new Set(["illustrator"]),
        bypassCustomAgentActivation: true,
      },
    );

    const results = await runtime.runPost("Mira catches the candle before it hits the floor.");

    expect(results).toEqual([
      expect.objectContaining({
        agentType: "illustrator",
        success: true,
        data: expect.objectContaining({
          shouldGenerate: true,
          prompt: "Mira catches a candle in a moonlit library.",
        }),
      }),
    ]);
  });
});

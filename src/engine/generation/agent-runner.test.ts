import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import { createGenerationAgentRuntime, type GenerationAgentRuntimeInput } from "./agent-runner";
import type { JsonRecord } from "./runtime-records";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function testStorage(agentRows: JsonRecord[], connections: JsonRecord[]): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return asStorageValue<T[]>(agentRows);
      if (entity === "connections") return asStorageValue<T[]>(connections);
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "connections") {
        return asStorageValue<T | null>(connections.find((connection) => connection.id === id) ?? null);
      }
      return null;
    },
    async create() {
      throw new Error("create should not be called");
    },
    async update() {
      throw new Error("update should not be called");
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages() {
      return [];
    },
    async createChatMessage() {
      throw new Error("createChatMessage should not be called");
    },
    async updateChatMessage() {
      throw new Error("updateChatMessage should not be called");
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return asStorageValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listLorebookEntries() {
      return [];
    },
    async listLorebookEntriesByLorebookIds() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  };
}

const noopIntegrations: IntegrationGateway = {
  spotify: {
    async player<T = unknown>() {
      return asStorageValue<T>({});
    },
    async playlists<T = unknown>() {
      return asStorageValue<T>({});
    },
    async playlistTracks<T = unknown>() {
      return asStorageValue<T>({});
    },
    async searchTracks<T = unknown>() {
      return asStorageValue<T>({});
    },
    async playTrack<T = unknown>() {
      return asStorageValue<T>({});
    },
    async play<T = unknown>() {
      return asStorageValue<T>({});
    },
    async volume<T = unknown>() {
      return asStorageValue<T>({});
    },
  },
  customTools: {
    async execute<T = unknown>() {
      return asStorageValue<T>({});
    },
  },
  image: {
    async generate<T = unknown>() {
      return asStorageValue<T>({});
    },
  },
};

function llmCapturing(requests: LlmRequest[]): LlmGateway {
  return {
    async complete() {
      return "";
    },
    async listModels() {
      return [];
    },
    async *stream(request) {
      requests.push(request);
      yield { type: "token", text: '{"expressions":[]}' };
    },
  };
}

function runtimeInput(connection: JsonRecord): GenerationAgentRuntimeInput {
  return {
    chat: {
      id: "chat-1",
      mode: "roleplay",
      characterIds: ["char-1"],
      metadata: { spriteDisplayModes: ["expressions", "full-body"] },
    },
    connection,
    storedMessages: [{ role: "user", content: "hello" }],
    characters: [{ id: "char-1", name: "Hero", description: "", tags: [] }],
    persona: null,
    activatedLorebookEntries: [],
    chatSummary: null,
    agentTypes: new Set(["expression"]),
  };
}

describe("generation agent runner", () => {
  it("prints stripped full-body sprite aliases in expression agent prompts", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const visuals: VisualAssetGateway = {
      async listSprites() {
        return [{ expression: "happy" }, { expression: "full_idle" }, { expression: "full_combat" }];
      },
      async listBackgrounds() {
        return [];
      },
    };

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "expression-agent",
              type: "expression",
              name: "Expression Agent",
              enabled: true,
              phase: "parallel",
              connectionId: connection.id,
              model: "qa-model",
            },
          ],
          [connection],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
        visuals,
      },
      runtimeInput(connection),
    );

    expect(runtime.availableSprites[0]?.expressions).toEqual(expect.arrayContaining(["happy", "idle", "combat"]));
    await runtime.runParallel();
    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("Hero (char-1):");
    expect(prompt).toContain("idle");
    expect(prompt).toContain("combat");
    expect(prompt).not.toContain("full_idle");
    expect(prompt).not.toContain("full_combat");
  });

  it("skips unavailable legacy Local Model agent overrides with a dedicated warning", async () => {
    const requests: LlmRequest[] = [];
    const sidecarConnection = {
      id: LOCAL_SIDECAR_CONNECTION_ID,
      name: "Local Model",
      provider: "sidecar",
      model: LOCAL_SIDECAR_MODEL,
      enabled: true,
    };

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "expression-agent",
              type: "expression",
              name: "Expression Agent",
              enabled: true,
              phase: "parallel",
              connectionId: LOCAL_SIDECAR_CONNECTION_ID,
              model: LOCAL_SIDECAR_MODEL,
            },
          ],
          [],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
        visuals: {
          async listSprites() {
            return [{ expression: "happy" }];
          },
          async listBackgrounds() {
            return [];
          },
        },
      },
      runtimeInput(sidecarConnection),
    );

    expect(runtime.preResults).toEqual([
      expect.objectContaining({
        success: false,
        data: expect.objectContaining({
          code: "local_sidecar_unavailable",
          connectionId: LOCAL_SIDECAR_CONNECTION_ID,
        }),
      }),
    ]);
    expect(runtime.agentWarnings).toEqual([
      expect.objectContaining({
        code: "local_sidecar_unavailable",
        agentNames: ["Expression Agent"],
      }),
    ]);
    await runtime.runParallel();
    expect(requests).toEqual([]);
  });

  it("still skips agents assigned to missing generic API connections", async () => {
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "expression-agent",
              type: "expression",
              name: "Expression Agent",
              enabled: true,
              phase: "parallel",
              connectionId: "deleted-connection",
              model: "qa-model",
            },
          ],
          [connection],
        ),
        llm: llmCapturing([]),
        integrations: noopIntegrations,
        visuals: {
          async listSprites() {
            return [{ expression: "happy" }];
          },
          async listBackgrounds() {
            return [];
          },
        },
      },
      runtimeInput(connection),
    );

    expect(runtime.preResults).toEqual([
      expect.objectContaining({
        success: false,
        data: expect.objectContaining({
          code: "dangling_agent_connection",
          connectionId: "deleted-connection",
        }),
      }),
    ]);
  });
});

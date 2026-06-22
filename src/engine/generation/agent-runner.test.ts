import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import {
  createGenerationAgentRuntime,
  type AgentConnectionWarning,
  type GenerationAgentRuntimeInput,
} from "./agent-runner";
import { LOREBOOK_WRITE_TOOL_NAME } from "./tools-runtime";
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
    async getChatMessage() {
      return null;
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

function acceptAgentConnectionWarning(_warning: AgentConnectionWarning): void {}

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

function activeAgentRuntimeInput(
  connection: JsonRecord,
  options: {
    mode?: string;
    activeAgentIds?: string[];
    enableAgents?: boolean;
    agentTypes?: Set<string>;
  },
): GenerationAgentRuntimeInput {
  return {
    ...runtimeInput(connection),
    chat: {
      id: "chat-1",
      mode: options.mode ?? "roleplay",
      characterIds: ["char-1"],
      metadata: {
        activeAgentIds: options.activeAgentIds ?? [],
        ...(options.enableAgents === undefined ? {} : { enableAgents: options.enableAgents }),
      },
    },
    agentTypes: options.agentTypes,
  };
}

describe("generation agent runner", () => {
  it("models default connection warning details as required", () => {
    acceptAgentConnectionWarning({
      code: "default_agent_connection_active",
      severity: "warning",
      agentNames: ["Expression Agent"],
      connectionId: "conn-api",
      connectionName: "API",
      model: "qa-model",
      dismissalKey: "default_agent_connection_active:conn-api",
      message: "Expression Agent is using the default agent connection.",
    });
    // @ts-expect-error Default agent connection warnings require connectionName and model.
    acceptAgentConnectionWarning({
      code: "default_agent_connection_active",
      severity: "warning",
      agentNames: ["Expression Agent"],
      message: "Expression Agent is using the default agent connection.",
    });
  });

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

  it("includes persona sprites for expression avatars even when sprite owners are character-filtered", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const visuals: VisualAssetGateway = {
      async listSprites(ownerId, ownerType) {
        if (ownerId === "char-1" && ownerType === "character") return [{ expression: "happy" }];
        if (ownerId === "persona-1" && ownerType === "persona") return [{ expression: "shy" }];
        return [];
      },
      async listBackgrounds() {
        return [];
      },
    };

    const input = runtimeInput(connection);
    input.chat = {
      ...input.chat,
      personaId: "persona-1",
      metadata: {
        spriteDisplayModes: ["expressions"],
        spriteCharacterIds: ["character:char-1"],
        expressionAvatarsEnabled: true,
      },
    };
    input.persona = { name: "Player", description: "", tags: [] };

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "expression-agent",
              type: "expression",
              name: "Expression Agent",
              enabled: true,
              phase: "post_processing",
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
      input,
    );

    expect(runtime.availableSprites).toEqual([
      expect.objectContaining({
        characterId: "char-1",
        characterName: "Hero",
        expressions: expect.arrayContaining(["happy"]),
      }),
      expect.objectContaining({
        characterId: "persona-1",
        characterName: "Player",
        expressions: expect.arrayContaining(["shy"]),
      }),
    ]);

    await runtime.runPost("Mira smiles at you.");
    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("Return exactly one expression for every owner in <available_sprites>.");
    expect(prompt).toContain("Player (persona-1) [active user persona]:");
    expect(prompt).toContain("<latest_user_message>\nhello\n</latest_user_message>");
  });

  it("keeps persona sprites out when sprite owners are character-filtered and expression avatars are off", async () => {
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const visuals: VisualAssetGateway = {
      async listSprites(ownerId, ownerType) {
        if (ownerId === "char-1" && ownerType === "character") return [{ expression: "happy" }];
        if (ownerId === "persona-1" && ownerType === "persona") return [{ expression: "shy" }];
        return [];
      },
      async listBackgrounds() {
        return [];
      },
    };

    const input = runtimeInput(connection);
    input.chat = {
      ...input.chat,
      personaId: "persona-1",
      metadata: {
        spriteDisplayModes: ["expressions"],
        spriteCharacterIds: ["character:char-1"],
      },
    };
    input.persona = { name: "Player", description: "", tags: [] };
    input.storedMessages = [{ role: "user", content: "I blush and look away." }];

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "expression-agent",
              type: "expression",
              name: "Expression Agent",
              enabled: true,
              phase: "post_processing",
              connectionId: connection.id,
              model: "qa-model",
            },
          ],
          [connection],
        ),
        llm: llmCapturing([]),
        integrations: noopIntegrations,
        visuals,
      },
      input,
    );

    expect(runtime.availableSprites).toEqual([expect.objectContaining({ characterId: "char-1", characterName: "Hero" })]);
  });

  it("does not run remembered active agents when legacy metadata disables agents", async () => {
    const requests: LlmRequest[] = [];
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
              connectionId: connection.id,
              model: "qa-model",
            },
          ],
          [connection],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      activeAgentRuntimeInput(connection, {
        activeAgentIds: ["expression"],
        enableAgents: false,
      }),
    );

    expect(runtime.preResults).toEqual([]);
    await runtime.runParallel();
    await runtime.runPost("main response");
    expect(requests).toEqual([]);
  });

  it("filters built-in agents that are unavailable for the chat mode", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };

    const staleScopedRuntime = await createGenerationAgentRuntime(
      {
        storage: testStorage([], [connection]),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      activeAgentRuntimeInput(connection, {
        mode: "game",
        activeAgentIds: ["cyoa"],
      }),
    );
    await staleScopedRuntime.runPost("main response");

    const explicitRetryRuntime = await createGenerationAgentRuntime(
      {
        storage: testStorage([], [connection]),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      activeAgentRuntimeInput(connection, {
        mode: "game",
        agentTypes: new Set(["cyoa"]),
      }),
    );
    await explicitRetryRuntime.runPost("main response");

    expect(requests).toEqual([]);
  });

  it("runs agents assigned to the synthetic Local Model connection", async () => {
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

    expect(runtime.preResults).toEqual([]);
    expect(runtime.agentWarnings).toEqual([]);
    await runtime.runParallel();
    expect(requests).toEqual([
      expect.objectContaining({
        connectionId: LOCAL_SIDECAR_CONNECTION_ID,
        model: LOCAL_SIDECAR_MODEL,
      }),
    ]);
  });

  it("runs agents that inherit a default Local Model connection", async () => {
    const requests: LlmRequest[] = [];
    const apiConnection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const sidecarConnection = {
      id: LOCAL_SIDECAR_CONNECTION_ID,
      name: "Local Model",
      provider: "sidecar",
      model: LOCAL_SIDECAR_MODEL,
      defaultForAgents: true,
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
            },
          ],
          [apiConnection, sidecarConnection],
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
      runtimeInput(apiConnection),
    );

    expect(runtime.preResults).toEqual([]);
    expect(runtime.agentWarnings).toEqual([]);
    await runtime.runParallel();
    expect(requests).toEqual([
      expect.objectContaining({
        connectionId: LOCAL_SIDECAR_CONNECTION_ID,
        model: LOCAL_SIDECAR_MODEL,
      }),
    ]);
  });

  it("runs agents that inherit the generation Local Model connection", async () => {
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

    expect(runtime.preResults).toEqual([]);
    expect(runtime.agentWarnings).toEqual([]);
    await runtime.runParallel();
    expect(requests).toEqual([
      expect.objectContaining({
        connectionId: LOCAL_SIDECAR_CONNECTION_ID,
        model: LOCAL_SIDECAR_MODEL,
      }),
    ]);
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

  it("keeps agent-only writer tools when chat tool settings use a visible subset", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const input = activeAgentRuntimeInput(connection, {
      activeAgentIds: ["writer-agent"],
    });
    input.chat.metadata = {
      activeAgentIds: ["writer-agent"],
      enableTools: true,
      activeToolIds: ["search_lorebook"],
    };
    input.bypassCustomAgentActivation = true;

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "writer-agent",
              type: "custom-writer",
              name: "Writer Agent",
              enabled: true,
              phase: "post_processing",
              promptTemplate: "Use available tools when useful.",
              connectionId: connection.id,
              model: "qa-model",
              settings: {
                enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
                lorebookWriteEnabled: true,
                writableLorebookId: "book-1",
              },
            },
          ],
          [connection],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      input,
    );

    await runtime.runPost("main response");

    expect(requests[0]?.tools?.map((tool) => tool.name).sort()).toEqual([
      LOREBOOK_WRITE_TOOL_NAME,
      "search_lorebook",
    ]);
  });

  it("does not expose the writer tool when the explicit writer flag is disabled", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const input = activeAgentRuntimeInput(connection, {
      activeAgentIds: ["writer-agent"],
    });
    input.chat.metadata = {
      activeAgentIds: ["writer-agent"],
      enableTools: true,
      activeToolIds: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
    };
    input.bypassCustomAgentActivation = true;

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "writer-agent",
              type: "custom-writer",
              name: "Writer Agent",
              enabled: true,
              phase: "post_processing",
              promptTemplate: "Use available tools when useful.",
              connectionId: connection.id,
              model: "qa-model",
              settings: {
                enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
                lorebookWriteEnabled: false,
                writableLorebookId: "book-1",
              },
            },
          ],
          [connection],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      input,
    );

    await runtime.runPost("main response");

    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(["search_lorebook"]);
  });
});

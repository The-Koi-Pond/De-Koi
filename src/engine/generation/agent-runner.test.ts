import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { LOCAL_SIDECAR_CONNECTION_ID, LOCAL_SIDECAR_MODEL } from "../contracts/types/sidecar";
import {
  createGenerationAgentRuntime,
  runFocusedRoleplayQualityAudit,
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
  it("runs a disabled built-in editor through the focused core Roleplay audit contract", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        yield {
          type: "token",
          text: JSON.stringify({
            editedText: 'Mira closes the ledger. "Decide when you are ready."',
            changes: [
              {
                reason: "agency",
                description: "Removed dialogue assigned to the persona.",
                evidence: '"I accept," Celia says.',
              },
            ],
          }),
        };
      },
    };
    const input = runtimeInput(connection);
    input.persona = { name: "Celia", description: "", tags: [] };
    input.storedMessages = [
      { role: "user", content: "I study the contract." },
      { role: "assistant", content: "Mira pushes the ledger closer." },
    ];

    const result = await runFocusedRoleplayQualityAudit(
      {
        storage: testStorage(
          [
            {
              id: "editor",
              type: "editor",
              name: "Consistency Editor",
              enabled: false,
              phase: "post_processing",
              connectionId: connection.id,
              model: "qa-model",
              promptTemplate: "A user-customized manual editor prompt that must not control the core audit.",
            },
          ],
          [connection],
        ),
        llm,
        integrations: noopIntegrations,
      },
      input,
      {
        mainResponse: '"I accept," Celia says, taking the contract.',
        agencyContract: "strict agency: never write the user's dialogue or deliberate actions.",
        signals: [
          {
            kind: "agency_candidate",
            severity: "high",
            evidence: ['"I accept," Celia says, taking the contract.'],
            guidance: "Audit the assigned dialogue.",
          },
        ],
      },
    );

    expect(result).toEqual(expect.objectContaining({ success: true, type: "text_rewrite" }));
    expect(requests).toHaveLength(1);
    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("focused Roleplay quality editor");
    expect(prompt).toContain(
      "Treat the `agencyContract` field in the appended Focused audit policy as authoritative",
    );
    expect(prompt).toContain("strict agency:");
    expect(prompt).toContain("agency_candidate");
    expect(prompt).toContain("<assistant_response>");
    expect(prompt).toContain('"I accept," Celia says, taking the contract.');
    expect(prompt).not.toContain("user-customized manual editor prompt");
    expect(requests[0]?.parameters?.maxTokens).toBeLessThanOrEqual(1200);
  });

  it("returns a normal failed result when the focused audit has no runnable model", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "No model", provider: "openai", model: "" };

    const result = await runFocusedRoleplayQualityAudit(
      {
        storage: testStorage([], [connection]),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      runtimeInput(connection),
      {
        mainResponse: "You agree to the bargain.",
        agencyContract: "strict agency: preserve the user's choices.",
        signals: [
          {
            kind: "agency_candidate",
            severity: "high",
            evidence: ["You agree to the bargain."],
            guidance: "Audit the assigned decision.",
          },
        ],
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        type: "text_rewrite",
        error: expect.stringContaining("model"),
        data: {
          code: "missing_editor_model",
          agentId: "editor",
          agentType: "editor",
          failure: "No runnable model is available for the focused Roleplay quality audit.",
        },
      }),
    );
    expect(requests).toEqual([]);
  });

  it("omits the agency contract from audits that have no agency signal", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        yield { type: "token", text: '{"edits":[]}' };
      },
    };

    await runFocusedRoleplayQualityAudit(
      {
        storage: testStorage([], [connection]),
        llm,
        integrations: noopIntegrations,
      },
      runtimeInput(connection),
      {
        mainResponse: "His hand鞭s close around the latch.",
        agencyContract: "strict agency: preserve the user's choices.",
        signals: [
          {
            kind: "malformed_output",
            severity: "high",
            evidence: ["hand鞭s"],
            guidance: "Repair the malformed word.",
          },
        ],
      },
    );

    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain('"agencyContract":null');
    expect(prompt).not.toContain("strict agency: preserve the user's choices.");
  });

  it("rejects a focused audit when the authoritative agency contract is missing", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };

    const result = await runFocusedRoleplayQualityAudit(
      {
        storage: testStorage(
          [
            {
              id: "editor",
              type: "editor",
              name: "Consistency Editor",
              enabled: false,
              phase: "post_processing",
              connectionId: connection.id,
              model: "qa-model",
            },
          ],
          [connection],
        ),
        llm: llmCapturing(requests),
        integrations: noopIntegrations,
      },
      runtimeInput(connection),
      {
        mainResponse: "You agree to the bargain.",
        agencyContract: "  ",
        signals: [
          {
            kind: "agency_candidate",
            severity: "high",
            evidence: ["You agree to the bargain."],
            guidance: "Audit the assigned decision.",
          },
        ],
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        data: expect.objectContaining({
          code: "missing_agency_contract",
          agentType: "editor",
        }),
      }),
    );
    expect(requests).toEqual([]);
  });

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

  it("gives the background agent generation-only context without reading library backgrounds", async () => {
    const requests: LlmRequest[] = [];
    const connection = { id: "conn-1", name: "API", provider: "openai", model: "qa-model" };
    const visuals: VisualAssetGateway = {
      async listSprites() {
        return [];
      },
      async listBackgrounds() {
        throw new Error("generation-only background context must not enumerate library backgrounds");
      },
    };
    const input = runtimeInput(connection);
    input.agentTypes = new Set(["background"]);

    const runtime = await createGenerationAgentRuntime(
      {
        storage: testStorage(
          [
            {
              id: "background-agent",
              type: "background",
              name: "Background Agent",
              enabled: true,
              phase: "post_processing",
              connectionId: connection.id,
              model: "qa-model",
              settings: { autoGenerateBackgrounds: true },
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

    await runtime.runPost("Rain falls over an empty moonlit archive.");
    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain('<background_generation enabled="true">');
    expect(prompt).toContain('Always return "chosen": null');
    expect(prompt).not.toContain("<available_backgrounds>");
    expect(prompt).not.toContain("library/castle.png");
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

describe("Narrative Craft runtime cadence", () => {
  const connection = { id: "conn-craft", name: "API", provider: "openai", model: "craft-model" };

  function storageForNarrativeCraft(options: {
    agentRuns?: JsonRecord[];
    memoryRows?: JsonRecord[];
  }): StorageGateway {
    const base = testStorage([], [connection]);
    const memoryRows = (options.memoryRows ?? []).map((row) => ({ ...row }));
    return {
      ...base,
      async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
        if (entity === "agent-runs") return asStorageValue<T[]>(options.agentRuns ?? []);
        if (entity === "agent-memory") return asStorageValue<T[]>(memoryRows);
        return base.list<T>(entity);
      },
      async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
        if (entity !== "agent-memory") return base.create<T>(entity, value);
        const row = { id: `memory-${memoryRows.length + 1}`, ...value };
        memoryRows.push(row);
        return asStorageValue<T>(row);
      },
      async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
        if (entity !== "agent-memory") return base.update<T>(entity, id, patch);
        const index = memoryRows.findIndex((row) => row.id === id);
        if (index >= 0) memoryRows[index] = { ...memoryRows[index], ...patch };
        return asStorageValue<T>(memoryRows[index] ?? patch);
      },
    };
  }

  function narrativeCraftLlm(requests: LlmRequest[]): LlmGateway {
    return {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        yield {
          type: "token",
          text: JSON.stringify({
            text: "Let the unanswered question remain open.",
            evidence: ["Two questions remain unresolved.", "Three questions remain unresolved."],
            issue: "tidy-resolution",
            state: {
              version: 1,
              pacing: "quiet",
              threads: [],
              openQuestions: ["Who left the note?"],
              withheldInformation: [],
              unresolvedConsequences: [],
              recentShapeChoices: [],
              lastGuidance: ["Let the unanswered question remain open."],
            },
            reason: "The scene has been resolving each question immediately.",
            intervened: true,
          }),
        };
        yield { type: "done" };
      },
    };
  }

  function narrativeInput(storedMessages: JsonRecord[]): GenerationAgentRuntimeInput {
    const input = activeAgentRuntimeInput(connection, { activeAgentIds: ["narrative-craft"] });
    input.storedMessages = storedMessages;
    return input;
  }

  it("does not call Narrative Craft before generation and forced analysis receives the completed response", async () => {
    const requests: LlmRequest[] = [];
    const runtime = await createGenerationAgentRuntime(
      {
        storage: storageForNarrativeCraft({
          memoryRows: [
            {
              id: "state-1",
              agentConfigId: "builtin:narrative-craft",
              chatId: "chat-1",
              key: "state",
              value: JSON.stringify({ version: 1, pacing: "exploring", threads: [] }),
            },
          ],
        }),
        llm: narrativeCraftLlm(requests),
        integrations: noopIntegrations,
      },
      narrativeInput([
        { id: "assistant-1", role: "assistant", content: "Two questions remain unresolved." },
        { id: "user-1", role: "user", content: "I unfold the note." },
      ]),
    );

    expect(requests).toHaveLength(0);
    expect(runtime.preInjections).toEqual([]);
    expect(runtime.preResults).toEqual([]);

    await expect(
      runtime.runNarrativeCraftAnalysis("Three questions remain unresolved.", { force: true }),
    ).resolves.toEqual([
      expect.objectContaining({
        agentType: "narrative-craft",
        success: true,
        data: expect.objectContaining({
          text:
            "Avoid forcing a tidy resolution or summarizing closure in the next reply. Preserve the requested scene content, live threads, and character agency.",
          evidence: ["Two questions remain unresolved.", "Three questions remain unresolved."],
          intervened: true,
          state: expect.objectContaining({
            pacing: "quiet",
            openQuestions: ["Who left the note?"],
            lastGuidance: [
              "Avoid forcing a tidy resolution or summarizing closure in the next reply. Preserve the requested scene content, live threads, and character agency.",
            ],
          }),
        }),
      }),
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "<narrative_craft_state>",
    );
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "<assistant_response>",
    );
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "Three questions remain unresolved.",
    );
  });

  it("skips automatic analysis when the cheap recurrence trigger finds no candidate", async () => {
    const requests: LlmRequest[] = [];
    const runtime = await createGenerationAgentRuntime(
      {
        storage: storageForNarrativeCraft({}),
        llm: narrativeCraftLlm(requests),
        integrations: noopIntegrations,
      },
      narrativeInput([
        { id: "assistant-1", role: "assistant", content: "Mara repairs the radio in silence." },
        { id: "user-1", role: "user", content: "I hold the flashlight." },
      ]),
    );

    await expect(runtime.runNarrativeCraftAnalysis("The loose wire clicks into place.")).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("skips between cadence boundaries and runs on the fourth pending assistant turn", async () => {
    const lastRun = {
      id: "run-1",
      chatId: "chat-1",
      messageId: "assistant-1",
      agentId: "builtin:narrative-craft",
      agentType: "narrative-craft",
      success: true,
      createdAt: "2026-01-01T00:01:00.000Z",
    };
    const baseMessages = [
      { id: "assistant-1", role: "assistant", content: "One unresolved question." },
      { id: "user-2", role: "user", content: "Two?" },
      { id: "assistant-2", role: "assistant", content: "Two questions remain unresolved." },
      { id: "user-3", role: "user", content: "Three?" },
      { id: "assistant-3", role: "assistant", content: "Three questions remain unresolved." },
      { id: "user-4", role: "user", content: "Four?" },
    ];
    const skippedRequests: LlmRequest[] = [];
    const skipped = await createGenerationAgentRuntime(
      {
        storage: storageForNarrativeCraft({ agentRuns: [lastRun] }),
        llm: narrativeCraftLlm(skippedRequests),
        integrations: noopIntegrations,
      },
      narrativeInput(baseMessages),
    );
    expect(skippedRequests).toHaveLength(0);
    expect(skipped.preInjections).toEqual([]);
    await expect(
      skipped.runNarrativeCraftAnalysis("Her breath caught as the dial moved."),
    ).resolves.toEqual([]);

    const dueRequests: LlmRequest[] = [];
    const due = await createGenerationAgentRuntime(
      {
        storage: storageForNarrativeCraft({ agentRuns: [lastRun] }),
        llm: narrativeCraftLlm(dueRequests),
        integrations: noopIntegrations,
      },
      narrativeInput([
        ...baseMessages.slice(0, -1),
        { id: "assistant-4", role: "assistant", content: "His breath caught as the lock moved." },
        { id: "user-5", role: "user", content: "Five?" },
      ]),
    );
    expect(dueRequests).toHaveLength(0);
    await expect(due.runNarrativeCraftAnalysis("Her breath caught as the dial moved.")).resolves.toHaveLength(1);
    expect(dueRequests).toHaveLength(1);
    expect(due.preInjections).toEqual([]);
  });

  it("claims cached guidance for exactly one later generation", async () => {
    const requests: LlmRequest[] = [];
    const state = {
      version: 1,
      pacing: "quiet",
      threads: [],
      openQuestions: [],
      withheldInformation: [],
      unresolvedConsequences: [],
      recentShapeChoices: [],
      lastGuidance: ["Avoid repeating the cited rhetorical shape."],
      pendingGuidance: ["Avoid repeating the cited rhetorical shape."],
      lastAnalysisReason: "The same opening appeared twice.",
    };
    const storage = storageForNarrativeCraft({
      memoryRows: [
        {
          id: "state-row",
          agentConfigId: "builtin:narrative-craft",
          chatId: "chat-1",
          key: "state",
          value: JSON.stringify(state),
        },
      ],
    });
    const input = narrativeInput([{ id: "user-1", role: "user", content: "Continue." }]);

    const first = await createGenerationAgentRuntime(
      { storage, llm: narrativeCraftLlm(requests), integrations: noopIntegrations },
      input,
    );
    const second = await createGenerationAgentRuntime(
      { storage, llm: narrativeCraftLlm(requests), integrations: noopIntegrations },
      input,
    );

    expect(first.preInjections).toEqual([
      {
        agentType: "narrative-craft",
        agentName: "Narrative Craft",
        text: "Avoid repeating the cited rhetorical shape.",
      },
    ]);
    expect(second.preInjections).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("collapses all retired active IDs to one runtime call", async () => {
    const requests: LlmRequest[] = [];
    const input = activeAgentRuntimeInput(connection, {
      activeAgentIds: ["prose-guardian", "director", "secret-plot-driver"],
    });
    const runtime = await createGenerationAgentRuntime(
      {
        storage: storageForNarrativeCraft({}),
        llm: narrativeCraftLlm(requests),
        integrations: noopIntegrations,
      },
      input,
    );
    await runtime.runNarrativeCraftAnalysis("Three questions remain unresolved.", { force: true });
    expect(requests).toHaveLength(1);
  });
});

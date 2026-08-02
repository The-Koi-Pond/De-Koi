import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { dryRunGeneration, startGeneration } from "./start-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function narrativeCraftBackgroundStorage(initialMessages?: Record<string, unknown>[]) {
  const chat = {
    id: "chat-1",
    mode: "roleplay",
    connectionId: "conn-1",
    characterIds: [],
    metadata: {
      activeAgentIds: ["narrative-craft"],
      automaticRoleplayQualityCorrection: false,
    },
  };
  const connection = { id: "conn-1", provider: "test-provider", model: "test-model" };
  const editorConnection = { id: "editor-conn", provider: "test-provider", model: "editor-model" };
  const messages: Record<string, unknown>[] = (
    initialMessages ?? [
      {
        id: "assistant-previous",
        chatId: chat.id,
        role: "assistant",
        content: "His breath caught as the lock moved.",
        createdAt: "2026-07-30T12:00:00.000Z",
      },
    ]
  ).map((message) => ({ ...message }));
  const creates: Array<{ entity: StorageEntity; value: Record<string, unknown> }> = [];
  const agentRunPersisted = deferred<void>();

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") {
        return [
          {
            id: "builtin:narrative-craft",
            type: "narrative-craft",
            enabled: true,
            settings: { runInterval: 1 },
          },
          {
            id: "editor",
            type: "editor",
            name: "Consistency Editor",
            enabled: false,
            phase: "post_processing",
            connectionId: editorConnection.id,
            model: editorConnection.model,
          },
        ] as T[];
      }
      if (entity === "connections") return [connection, editorConnection] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
      if (entity === "connections" && id === editorConnection.id) return editorConnection as T;
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      creates.push({ entity, value });
      if (entity === "agent-runs") agentRunPersisted.resolve();
      return { id: `${entity}-${creates.length}`, ...value } as T;
    },
    async update<T = unknown>() {
      return {} as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      const message = {
        id: `message-${messages.length + 1}`,
        chatId,
        createdAt: `2026-07-30T12:00:0${messages.length}.000Z`,
        ...value,
      };
      messages.push(message);
      return message as T;
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

  return { storage, creates, messages, agentRunPersisted };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

describe("startGeneration Narrative Craft background analysis", () => {
  it("passes an empty scene opener guide through the Agent planner into the writer prompt", async () => {
    const { storage } = narrativeCraftBackgroundStorage([]);
    const requests: LlmRequest[] = [];
    const openingIntent = "Harlequin steps into the corridor and blocks the way.";
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Harlequin blocks the door.","dialogue":"Say it again.","stop":"His hand on the push bar."}',
          };
          return;
        }
        yield { type: "token", text: 'Harlequin blocks the door. "Say it again."' };
        yield { type: "done" };
      },
    };

    for await (const event of dryRunGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        generationGuide: `Open this roleplay scene now.\n\nPlanned opening beat:\n${openingIntent}`,
        generationGuideSource: "narrator",
      },
    )) {
      if (event.type === "done") break;
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining(openingIntent),
    });
    expect(requests[1]?.connectionId).toBe("conn-1");
    expect(requests[1]?.messages.map((message) => message.content).join("\n")).toContain("Private beat plan");
  });

  it("uses the same private Agent beat plan in a Narrative Craft dry run", async () => {
    const { storage } = narrativeCraftBackgroundStorage();
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Mara turns the dial.","dialogue":"","stop":"Her claw on the radio."}',
          };
          return;
        }
        yield { type: "token", text: "Mara turns the dial and leaves her claw on the radio." };
        yield { type: "done" };
      },
    };

    for await (const event of dryRunGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", message: "Continue." },
    )) {
      if (event.type === "done") break;
    }

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.connectionId)).toEqual(["editor-conn", "conn-1"]);
    expect(requests[1]?.messages.map((message) => message.content).join("\n")).toContain("Private beat plan");
  });

  it("finishes the visible reply before starting the critic and persists its later result", async () => {
    vi.useFakeTimers();
    const { storage, creates, agentRunPersisted } = narrativeCraftBackgroundStorage();
    const criticGate = deferred<void>();
    let criticStarted = false;
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"She turns the dial.","dialogue":"","stop":"Her hand on the radio."}',
          };
          return;
        }
        if (prompt.includes("You are Narrative Craft")) {
          criticStarted = true;
          await criticGate.promise;
          yield {
            type: "token",
            text: JSON.stringify({
              text: "Avoid another generic physiological cue.",
              evidence: ["His breath caught as the lock moved.", "Her breath caught as the dial moved."],
              issue: "emotional-gesture",
              state: {
                version: 1,
                pacing: "quiet",
                threads: [],
                openQuestions: [],
                withheldInformation: [],
                unresolvedConsequences: [],
                recentShapeChoices: [],
                lastGuidance: [],
              },
              reason: "The same physiological shorthand appeared twice.",
              intervened: true,
            }),
          };
          yield { type: "done" };
          return;
        }
        yield { type: "token", text: "Her breath caught as the dial moved." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "I turn the dial." },
    );

    try {
      await advanceToDone(generation);
      expect(criticStarted).toBe(false);
      expect(requests).toHaveLength(2);
      expect(
        requests[1]?.messages
          .map((message) => message.content)
          .join("\n")
          .match(/<narrative_craft>/g),
      ).toHaveLength(1);

      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(criticStarted).toBe(true);

      criticGate.resolve();
      await agentRunPersisted.promise;
      expect(creates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entity: "agent-memory" }),
          expect.objectContaining({ entity: "agent-runs" }),
        ]),
      );
    } finally {
      criticGate.resolve();
      vi.useRealTimers();
    }
  });

  it("applies one Narrative Craft guide and schedules first analysis for direct messages", async () => {
    vi.useFakeTimers();
    const { storage, agentRunPersisted } = narrativeCraftBackgroundStorage();
    const criticGate = deferred<void>();
    let criticStarted = false;
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"The radio clicks.","dialogue":"","stop":"One lit dial in the quiet room."}',
          };
          return;
        }
        if (prompt.includes("You are Narrative Craft")) {
          criticStarted = true;
          await criticGate.promise;
          yield {
            type: "token",
            text: JSON.stringify({
              text: "",
              evidence: [],
              issue: "",
              state: {
                version: 1,
                pacing: "quiet",
                threads: [],
                openQuestions: [],
                withheldInformation: [],
                unresolvedConsequences: [],
                recentShapeChoices: [],
                lastGuidance: [],
              },
              reason: "No recurring shape requires later guidance.",
              intervened: false,
            }),
          };
          yield { type: "done" };
          return;
        }
        yield { type: "token", text: "The radio clicks once in the quiet room." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Continue the quiet scene." }],
      },
    );

    try {
      await advanceToDone(generation);
      expect(criticStarted).toBe(false);
      expect(requests).toHaveLength(2);
      const writerPrompt = requests[1]?.messages.map((message) => message.content).join("\n") ?? "";
      expect(writerPrompt.match(/<narrative_craft>/g)).toHaveLength(1);
      expect(writerPrompt).toContain("Trust the reader");
      expect(writerPrompt).toContain("Explicit style requests control");

      await generation.return(undefined);
      await vi.runOnlyPendingTimersAsync();
      expect(criticStarted).toBe(true);

      criticGate.resolve();
      await agentRunPersisted.promise;
    } finally {
      criticGate.resolve();
      vi.useRealTimers();
    }
  });

  it("puts deterministic Roleplay guidance and one bounded Agent plan in the writer request", async () => {
    vi.useFakeTimers();
    const { storage } = narrativeCraftBackgroundStorage([
      {
        id: "assistant-1",
        chatId: "chat-1",
        role: "assistant",
        content: "Not quickly. Not carelessly. Just one measured step.",
      },
      { id: "user-1", chatId: "chat-1", role: "user", content: "I wait." },
      {
        id: "assistant-2",
        chatId: "chat-1",
        role: "assistant",
        content: "No warning. No hesitation. Just the lock turning.",
      },
    ]);
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Mara moves the latch.","dialogue":"","stop":"Her thumb on the lock."}',
          };
          return;
        }
        yield { type: "token", text: "The latch moves under Mara's thumb." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Continue." },
    );

    try {
      await advanceToDone(generation);
      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.connectionId)).toEqual(["editor-conn", "conn-1"]);
      const writerPrompt = requests[1]?.messages.map((message) => message.content).join("\n") ?? "";
      expect(writerPrompt).toContain("Break the repeated contrast ladder.");
      expect(writerPrompt).toContain("Private beat plan");
      expect(writerPrompt.match(/<narrative_craft>/g)).toHaveLength(1);
      await generation.return(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a detected scaffold locally while Nano remains the only writer", async () => {
    vi.useFakeTimers();
    const { storage, messages } = narrativeCraftBackgroundStorage([
      {
        id: "assistant-1",
        chatId: "chat-1",
        role: "assistant",
        content: "Not quickly. Not carelessly. Just one measured step.",
      },
      { id: "user-1", chatId: "chat-1", role: "user", content: "I wait." },
      {
        id: "assistant-2",
        chatId: "chat-1",
        role: "assistant",
        content: "No warning. No hesitation. Just the lock turning.",
      },
    ]);
    const requests: LlmRequest[] = [];
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Mara moves the latch.","dialogue":"","stop":"Her thumb on the lock."}',
          };
          return;
        }
        yield { type: "token", text: "No warning. No theatrical pause. Just the latch moving under her thumb." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Continue." },
    );

    try {
      await advanceToDone(generation);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.connectionId).toBe("editor-conn");
      expect(requests[1]?.connectionId).toBe("conn-1");
      expect(requests[1]?.model).toBe("test-model");
      const saved = messages.filter((message) => message.role === "assistant").at(-1);
      expect(saved?.content).toBe("Just the latch moving under her thumb.");
      expect((saved?.extra as Record<string, unknown>)?.roleplayQualityCorrection).toMatchObject({
        source: "deterministic_craft_repair",
        reasons: ["repetition"],
      });
      await generation.return(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a shaped Nano stream at a complete beat instead of waiting for more generated paragraphs", async () => {
    vi.useFakeTimers();
    const { storage, messages } = narrativeCraftBackgroundStorage();
    const requests: LlmRequest[] = [];
    let writerSignal: AbortSignal | undefined;
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request, signal) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Mara holds the latch.","dialogue":"","stop":"Her open claw beside the lock."}',
          };
          return;
        }
        writerSignal = signal;
        yield {
          type: "token",
          text: "Mara keeps one claw on the latch while rain presses silver lines down the glass. ".repeat(6),
        };
        yield {
          type: "token",
          text: "\n\nTwo words. Stripped to nothing. His other claw remains open beside her.\n\n",
        };
        yield { type: "token", text: "This paragraph should never be consumed or saved." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      { chatId: "chat-1", connectionId: "conn-1", userMessage: "Continue." },
    );

    try {
      await advanceToDone(generation);
      expect(requests).toHaveLength(2);
      const saved = String(messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "");
      expect(saved).toContain("His other claw remains open beside her.");
      expect(saved).not.toContain("This paragraph should never be consumed or saved.");
      expect(writerSignal?.aborted).toBe(true);
      await generation.return(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not shorten an explicitly long direct-message Roleplay request", async () => {
    vi.useFakeTimers();
    const { storage, messages } = narrativeCraftBackgroundStorage();
    const requests: LlmRequest[] = [];
    let writerSignal: AbortSignal | undefined;
    const llm: LlmGateway = {
      async complete() {
        return "";
      },
      async listModels() {
        return [];
      },
      async *stream(request, signal) {
        requests.push(request);
        const prompt = request.messages.map((message) => message.content).join("\n");
        if (prompt.includes("silent beat planner")) {
          yield {
            type: "token",
            text: '{"action":"Mara tests the latch.","dialogue":"","stop":"Her claw beside the lock."}',
          };
          return;
        }
        writerSignal = signal;
        yield {
          type: "token",
          text: "Mara keeps one claw on the latch while rain traces the window. ".repeat(8),
        };
        yield { type: "token", text: "\n\nTwo words. Stripped to nothing. Her claw remains beside the lock.\n\n" };
        yield { type: "token", text: "Then she crosses the room and begins the second requested beat." };
        yield { type: "done" };
      },
    };
    const generation = startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        messages: [{ role: "user", content: "Write a long detailed scene with several beats." }],
      },
    );

    try {
      await advanceToDone(generation);
      expect(requests).toHaveLength(2);
      expect(writerSignal?.aborted).toBe(false);
      expect(messages.filter((message) => message.role === "assistant").at(-1)?.content).toContain(
        "begins the second requested beat",
      );
      await generation.return(undefined);
    } finally {
      vi.useRealTimers();
    }
  });
});

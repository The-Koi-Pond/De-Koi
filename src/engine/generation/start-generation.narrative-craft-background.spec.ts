import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { GenerationEvent } from "./generation-events";
import { startGeneration } from "./start-generation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function narrativeCraftBackgroundStorage() {
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
  const messages: Record<string, unknown>[] = [
    {
      id: "assistant-previous",
      chatId: chat.id,
      role: "assistant",
      content: "His breath caught as the lock moved.",
      createdAt: "2026-07-30T12:00:00.000Z",
    },
  ];
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
        ] as T[];
      }
      if (entity === "connections") return [connection] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "connections" && id === connection.id) return connection as T;
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

  return { storage, creates, agentRunPersisted };
}

async function advanceToDone(generator: AsyncGenerator<GenerationEvent>): Promise<void> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("Generation finished before emitting done.");
    if (next.value.type === "done") return;
  }
}

describe("startGeneration Narrative Craft background analysis", () => {
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
      expect(requests).toHaveLength(1);
      expect(requests[0]?.messages.map((message) => message.content).join("\n").match(/<narrative_craft>/g)).toHaveLength(
        1,
      );

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
      expect(requests).toHaveLength(1);
      const writerPrompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
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
});

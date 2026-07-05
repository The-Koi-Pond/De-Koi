import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function contextPriorityStorage(options: {
  character: Record<string, unknown>;
  memories: Record<string, unknown>[];
}): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "prompts") return [];
      if (["personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && options.character.id === id) return asStorageValue<T>(options.character);
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
    async listChatMemories<T = unknown>() {
      return asStorageValue<T[]>(options.memories);
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

function todayIso(): string {
  return new Date().toISOString();
}

describe("prompt context priority", () => {
  it("skips recalled memories already present in same-day character memories while keeping distinct recall", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira is a festival bard.",
            extensions: {
              characterMemories: [
                {
                  createdAt: todayIso(),
                  from: "user",
                  summary: "Mira keeps the silver bell braid for the festival.",
                },
              ],
            },
          },
        },
        memories: [
          {
            id: "duplicate-memory",
            content: "Mira keeps the silver bell braid for the festival.",
            createdAt: "2025-01-01T00:00:00.000Z",
            firstMessageAt: "2025-01-01T00:00:00.000Z",
            lastMessageAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "distinct-memory",
            content: "Mira promised to bring the jade umbrella to the festival.",
            createdAt: "2025-01-02T00:00:00.000Z",
            firstMessageAt: "2025-01-02T00:00:00.000Z",
            lastMessageAt: "2025-01-02T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "What does Mira remember about the festival?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Does Mira remember the silver bell braid and jade umbrella for the festival?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const recallMarker = "The following are recalled fragments from earlier in this chat.";
    const recallBlockText = promptText.slice(promptText.indexOf(recallMarker));

    expect(promptText).toContain("Mira keeps the silver bell braid for the festival.");
    expect(recallBlockText).toContain("Mira promised to bring the jade umbrella to the festival.");
    expect(recallBlockText).not.toContain("Mira keeps the silver bell braid for the festival.");
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory_recall",
          status: "skipped",
          sourceId: "duplicate-memory",
          metadata: expect.objectContaining({ reason: "overlaps_character_memory" }),
        }),
      ]),
    );
  });

  it("uses active migrated canonical memories while ignoring inactive legacy projections", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: { name: "Mira", description: "Mira remembers careful details." },
        },
        memories: [
          {
            id: "migrated-summary",
            canonicalMemoryVersion: 1,
            memoryKind: "summary",
            scopeType: "chat",
            scopeId: "chat-1",
            legacySourceLane: "chats.metadata.summaryEntries",
            legacySourceId: "summary-entry:old",
            content: "Mira knows the lantern key opens the archive gate.",
            createdAt: "2025-01-01T00:00:00.000Z",
            firstMessageAt: "2025-01-01T00:00:00.000Z",
            lastMessageAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "deleted-legacy",
            canonicalMemoryVersion: 1,
            memoryKind: "manual",
            status: "deleted",
            content: "Mira thinks the archive key was thrown away.",
            createdAt: "2025-01-02T00:00:00.000Z",
            firstMessageAt: "2025-01-02T00:00:00.000Z",
            lastMessageAt: "2025-01-02T00:00:00.000Z",
          },
          {
            id: "wrong-legacy",
            canonicalMemoryVersion: 1,
            memoryKind: "imported",
            status: "wrong",
            content: "Mira thinks the archive key is silver.",
            createdAt: "2025-01-03T00:00:00.000Z",
            firstMessageAt: "2025-01-03T00:00:00.000Z",
            lastMessageAt: "2025-01-03T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "What opens the archive gate?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "What does Mira know about the lantern key and archive gate?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("Mira knows the lantern key opens the archive gate.");
    expect(promptText).not.toContain("thrown away");
    expect(promptText).not.toContain("archive key is silver");
  });

  it("filters superseded canonical memories while retaining replacements", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: { name: "Mira", description: "Mira updates continuity when facts change." },
        },
        memories: [
          {
            id: "old-mask-location",
            canonicalMemoryVersion: 1,
            memoryKind: "manual",
            status: "active",
            supersededAt: "2026-01-02T00:00:00.000Z",
            supersededByMemoryId: "new-mask-location",
            content: "Mira believes the fox mask is hidden beneath the pier.",
            createdAt: "2026-01-01T00:00:00.000Z",
            firstMessageAt: "2026-01-01T00:00:00.000Z",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "new-mask-location",
            canonicalMemoryVersion: 1,
            memoryKind: "correction",
            status: "active",
            correctionOfMemoryId: "old-mask-location",
            content: "Mira knows the fox mask is locked in the cedar cabinet.",
            createdAt: "2026-01-02T00:00:00.000Z",
            firstMessageAt: "2026-01-02T00:00:00.000Z",
            lastMessageAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "Where is the fox mask now?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Where is the fox mask now?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("fox mask is locked in the cedar cabinet");
    expect(promptText).not.toContain("hidden beneath the pier");
  });
});

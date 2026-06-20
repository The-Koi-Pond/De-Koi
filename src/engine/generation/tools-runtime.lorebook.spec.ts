import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import type { LLMToolCall } from "../generation-core/llm/base-provider";
import {
  buildMainToolDefinitions,
  executeBuiltInTool,
  LOREBOOK_WRITE_TOOL_NAME,
  type ToolRuntimeInput,
} from "./tools-runtime";
import type { JsonRecord } from "./runtime-records";

const MAX_LOREBOOK_ENTRY_CONTENT_BYTES = 64 * 1024;

function asValue<T>(value: unknown): T {
  return value as T;
}

function toolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: `tool-${name}`,
    name,
    arguments: JSON.stringify(args),
    function: { name, arguments: JSON.stringify(args) },
  };
}

function runtimeInput(chat: JsonRecord = { id: "chat-1", mode: "roleplay", metadata: {} }): ToolRuntimeInput {
  return {
    chat,
    activatedLorebookEntries: [],
    characters: [],
    persona: null,
    chatSummary: null,
  };
}

function recordList<T = JsonRecord>(records: JsonRecord[], options?: StorageListOptions): T[] {
  let rows = [...records];
  if (options?.filters) {
    rows = rows.filter((row) => Object.entries(options.filters ?? {}).every(([key, value]) => row[key] === value));
  }
  return rows as T[];
}

function storageFor(args: {
  lorebooks: JsonRecord[];
  lorebookEntries: JsonRecord[];
  creates?: Array<{ entity: StorageEntity; value: JsonRecord }>;
  updates?: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }>;
}): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "lorebooks") return recordList<T>(args.lorebooks, options);
      if (entity === "lorebook-entries") return recordList<T>(args.lorebookEntries, options);
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      const rows = entity === "lorebooks" ? args.lorebooks : entity === "lorebook-entries" ? args.lorebookEntries : [];
      return asValue<T | null>(rows.find((row) => row.id === id) ?? null);
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `created-${args.lorebookEntries.length + 1}`, ...value };
      args.creates?.push({ entity, value: row });
      if (entity === "lorebook-entries") args.lorebookEntries.push(row);
      return asValue<T>(row);
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      args.updates?.push({ entity, id, patch: patch as JsonRecord });
      const rows = entity === "lorebook-entries" ? args.lorebookEntries : args.lorebooks;
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...patch };
      return asValue<T>(rows[index] ?? { id, ...patch });
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
      return asValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asValue<T>({});
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asValue<T>({});
    },
    async listLorebookEntries<T = unknown>(lorebookId: string) {
      return recordList<T>(args.lorebookEntries, { filters: { lorebookId } });
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  };
}

function integrations(): IntegrationGateway {
  return {
    spotify: {
      async player<T = unknown>() {
        return asValue<T>({});
      },
      async playlists<T = unknown>() {
        return asValue<T>({});
      },
      async playlistTracks<T = unknown>() {
        return asValue<T>({});
      },
      async searchTracks<T = unknown>() {
        return asValue<T>({});
      },
      async playTrack<T = unknown>() {
        return asValue<T>({});
      },
      async play<T = unknown>() {
        return asValue<T>({});
      },
      async volume<T = unknown>() {
        return asValue<T>({});
      },
    },
    customTools: {
      async execute<T = unknown>() {
        return asValue<T>({});
      },
    },
    image: {
      async generate<T = unknown>() {
        return asValue<T>({});
      },
    },
  };
}

function writableAgent(settings: JsonRecord = {}): JsonRecord {
  return {
    id: "agent-1",
    type: "custom-agent",
    settings: {
      enabledTools: [LOREBOOK_WRITE_TOOL_NAME],
      writableLorebookId: "book-1",
      ...settings,
    },
  };
}

describe("lorebook writer tool runtime", () => {
  it("keeps lorebook writes out of main chat tool definitions", async () => {
    const storage = storageFor({ lorebooks: [], lorebookEntries: [] });
    const mainTools = await buildMainToolDefinitions({
      chat: { id: "chat-1", metadata: { enableTools: true, activeToolIds: [LOREBOOK_WRITE_TOOL_NAME] } },
      storage,
      integrations: integrations(),
    });

    expect(mainTools).toBeNull();
  });

  it("creates entries in the agent writable lorebook", async () => {
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const lorebookEntries: JsonRecord[] = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries,
      creates,
    });

    const result = await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "A silver gate under the old observatory.",
        description: "Observatory landmark",
        keys: [" moon gate ", "moon gate", "observatory"],
        tag: "location",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      applied: true,
      action: "created",
      lorebookId: "book-1",
      lorebookName: "World Guide",
      name: "Moon Gate",
      sourceAgentId: "agent-1",
    });
    expect(creates).toEqual([
      {
        entity: "lorebook-entries",
        value: expect.objectContaining({
          lorebookId: "book-1",
          name: "Moon Gate",
          content: "A silver gate under the old observatory.",
          description: "Observatory landmark",
          keys: ["moon gate", "observatory"],
          tag: "location",
          enabled: true,
          role: "system",
        }),
      },
    ]);
    expect(lorebookEntries).toHaveLength(1);
  });

  it("rejects create mode when a matching entry already exists", async () => {
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries: [
        {
          id: "entry-1",
          lorebookId: "book-1",
          name: "Moon Gate",
          content: "Old content.",
          keys: [],
        },
      ],
      creates,
    });

    const result = await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "moon gate",
        content: "New content.",
        mode: "create",
      }),
    );

    expect(result).toMatchObject({
      success: false,
      applied: false,
      error: "A lorebook entry with this name already exists.",
      lorebookId: "book-1",
      entryId: "entry-1",
      name: "moon gate",
    });
    expect(creates).toEqual([]);
  });

  it("replaces matching entries by name and preserves existing keys and enabled state", async () => {
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const lorebookEntries: JsonRecord[] = [
      {
        id: "entry-1",
        lorebookId: "book-1",
        name: "Moon Gate",
        content: "Old content.",
        description: "Old description",
        keys: ["old-key"],
        tag: "old-tag",
        enabled: false,
      },
    ];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries,
      updates,
    });

    const result = await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "moon gate",
        content: "New content.",
        keys: ["new-key"],
      }),
    );

    expect(result).toMatchObject({ success: true, applied: true, action: "replaced", entryId: "entry-1" });
    expect(updates).toEqual([
      {
        entity: "lorebook-entries",
        id: "entry-1",
        patch: {
          content: "New content.",
          description: "Old description",
          keys: ["old-key", "new-key"],
        },
      },
    ]);
    expect(lorebookEntries[0]).toMatchObject({
      content: "New content.",
      description: "Old description",
      keys: ["old-key", "new-key"],
      enabled: false,
    });
  });

  it("appends new content without duplicating existing text", async () => {
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries: [
        {
          id: "entry-1",
          lorebookId: "book-1",
          name: "Moon Gate",
          content: "First note.",
          keys: [],
        },
      ],
      updates,
    });

    const result = await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "Second note.",
        mode: "append",
      }),
    );

    expect(result).toMatchObject({ success: true, applied: true, action: "appended" });
    expect(updates[0]?.patch.content).toBe("First note.\n\nSecond note.");

    await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "Second note.",
        mode: "append",
      }),
    );

    expect(updates[1]?.patch.content).toBe("First note.\n\nSecond note.");
  });

  it("appends substring-overlap content that is not an exact note block", async () => {
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries: [
        {
          id: "entry-1",
          lorebookId: "book-1",
          name: "Moon Gate",
          content: "The Moon Gate opens under the old observatory.",
          keys: [],
        },
      ],
      updates,
    });

    await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "Moon Gate",
        mode: "append",
      }),
    );

    expect(updates[0]?.patch.content).toBe("The Moon Gate opens under the old observatory.\n\nMoon Gate");
  });

  it("preserves disabled state when appending to a matched entry", async () => {
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const lorebookEntries: JsonRecord[] = [
      {
        id: "entry-1",
        lorebookId: "book-1",
        name: "Moon Gate",
        content: "First note.",
        keys: [],
        enabled: false,
      },
    ];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries,
      updates,
    });

    await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "Second note.",
        mode: "append",
      }),
    );

    expect(updates[0]?.patch).not.toHaveProperty("enabled");
    expect(lorebookEntries[0]?.enabled).toBe(false);
  });

  it("caps final appended content to the lorebook entry content limit", async () => {
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries: [
        {
          id: "entry-1",
          lorebookId: "book-1",
          name: "Moon Gate",
          content: "A".repeat(MAX_LOREBOOK_ENTRY_CONTENT_BYTES - 1),
          keys: [],
        },
      ],
      updates,
    });

    await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      writableAgent(),
      toolCall(LOREBOOK_WRITE_TOOL_NAME, {
        name: "Moon Gate",
        content: "B".repeat(100),
        mode: "append",
      }),
    );

    expect(String(updates[0]?.patch.content)).toHaveLength(MAX_LOREBOOK_ENTRY_CONTENT_BYTES);
  });

  it("refuses writes when the agent has no writable lorebook", async () => {
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = storageFor({
      lorebooks: [{ id: "book-1", name: "World Guide" }],
      lorebookEntries: [],
      creates,
      updates,
    });

    const result = await executeBuiltInTool(
      { storage, integrations: integrations() },
      runtimeInput(),
      { id: "agent-1", settings: { enabledTools: [LOREBOOK_WRITE_TOOL_NAME] } },
      toolCall(LOREBOOK_WRITE_TOOL_NAME, { name: "Moon Gate", content: "A gate." }),
    );

    expect(result).toEqual({ success: false, error: "Lorebook writing is not available in this context." });
    expect(creates).toEqual([]);
    expect(updates).toEqual([]);
  });
});

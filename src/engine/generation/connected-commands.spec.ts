import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { persistConnectedCommandTags } from "./connected-commands";
import type { JsonRecord } from "./runtime-records";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function recordList<T = JsonRecord>(records: JsonRecord[], options?: StorageListOptions): T[] {
  let rows = [...records];
  if (options?.filters) {
    rows = rows.filter((row) => Object.entries(options.filters ?? {}).every(([key, value]) => row[key] === value));
  }
  return rows as T[];
}

function commandStorage(args: {
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
    async get() {
      return null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `created-${args.creates?.length ?? 0}`, ...value };
      args.creates?.push({ entity, value: row });
      if (entity === "lorebook-entries") args.lorebookEntries.push(row);
      return asStorageValue<T>(row);
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      args.updates?.push({ entity, id, patch });
      const rows = entity === "lorebooks" ? args.lorebooks : entity === "lorebook-entries" ? args.lorebookEntries : [];
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...patch };
      return asStorageValue<T>(rows[index] ?? { id, ...patch });
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
    async listLorebookEntries<T = unknown>(lorebookId: string) {
      return recordList<T>(args.lorebookEntries, { filters: { lorebookId } });
    },
    async createLorebookEntries<T = unknown>(_lorebookId: string) {
      return asStorageValue<T[]>([]);
    },
    async promptFull() {
      return null;
    },
  };
}

describe("persistConnectedCommandTags", () => {
  it("updates matched lorebook entries instead of appending duplicates", async () => {
    const lorebooks = [{ id: "lore-1", name: "City Guide" }];
    const lorebookEntries = [
      {
        id: "entry-1",
        lorebookId: "lore-1",
        name: "Old Gate",
        content: "old content",
        keys: ["old"],
        secondaryKeys: ["old secondary"],
        enabled: false,
        constant: false,
        selective: true,
        tag: "old tag",
        order: 7,
      },
    ];
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = commandStorage({ lorebooks, lorebookEntries, creates, updates });

    const result = await persistConnectedCommandTags(
      storage,
      { id: "chat-1", mode: "conversation" },
      [
        "<update_lorebook>",
        JSON.stringify({
          name: "City Guide",
          entries: [
            {
              matchName: "Old Gate",
              name: "New Gate",
              content: "new content",
              keys: ["new"],
              secondaryKeys: ["new secondary"],
              constant: true,
              selective: false,
              tag: "new tag",
            },
            {
              name: "Fresh Gate",
              description: "fresh content",
              keys: ["fresh"],
            },
          ],
        }),
        "</update_lorebook>",
      ].join("\n"),
    );

    expect(result.executedCommands).toEqual(["update_lorebook"]);
    expect(updates).toContainEqual({
      entity: "lorebook-entries",
      id: "entry-1",
      patch: {
        name: "New Gate",
        content: "new content",
        keys: ["new"],
        secondaryKeys: ["new secondary"],
        constant: true,
        selective: false,
        tag: "new tag",
      },
    });
    expect(creates).toEqual([
      {
        entity: "lorebook-entries",
        value: {
          id: "created-0",
          lorebookId: "lore-1",
          name: "Fresh Gate",
          content: "fresh content",
          keys: ["fresh"],
          secondaryKeys: [],
          enabled: true,
          constant: false,
          selective: false,
          tag: "",
          order: 0,
        },
      },
    ]);
    expect(lorebookEntries.map((entry) => entry.name)).toEqual(["New Gate", "Fresh Gate"]);
  });
});

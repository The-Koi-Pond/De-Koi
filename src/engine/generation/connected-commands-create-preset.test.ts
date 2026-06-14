import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { persistConnectedCommandTags } from "./connected-commands";
import { parseCharacterCommands } from "../modes/chat/commands/character-commands";

type Row = Record<string, unknown> & { id: string };

function createStorage(): StorageGateway & { rows: Map<StorageEntity, Row[]> } {
  const rows = new Map<StorageEntity, Row[]>();
  const listRows = (entity: StorageEntity) => rows.get(entity) ?? [];

  const storage: Partial<StorageGateway> & { rows: Map<StorageEntity, Row[]> } = {
    rows,
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      let values = [...listRows(entity)];
      const filters = options && "filters" in options ? options.filters : undefined;
      if (filters) {
        values = values.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
      }
      return values as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      return (listRows(entity).find((row) => row.id === id) as T | undefined) ?? null;
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const id = typeof value.id === "string" ? value.id : `${entity}-${listRows(entity).length + 1}`;
      const row = { id, ...value } as Row;
      rows.set(entity, [...listRows(entity), row]);
      return row as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      const nextRows = listRows(entity).map((row) => (row.id === id ? { ...row, ...patch } : row));
      rows.set(entity, nextRows);
      return nextRows.find((row) => row.id === id) as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return [];
    },
    async createChatMessage<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async updateChatMessage<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async patchChatSummaries<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [];
    },
    async getWorldState<T = unknown>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T = unknown>(): Promise<T[]> {
      return [];
    },
    async createLorebookEntries<T = unknown>(): Promise<T[]> {
      return [];
    },
  };

  return storage as StorageGateway & { rows: Map<StorageEntity, Row[]> };
}

const createPresetBlock = `<create_preset>{
  "name": "Story Preset",
  "description": "Structured preset",
  "wrapFormat": "markdown",
  "author": "Professor Mari",
  "groups": [
    { "id": "tone", "name": "Tone", "order": 10 }
  ],
  "sections": [
    {
      "identifier": "voice",
      "name": "Voice",
      "content": "Write in {{style}}.",
      "role": "system",
      "groupId": "tone",
      "order": 20
    }
  ],
  "choiceBlocks": [
    {
      "variableName": "style",
      "question": "Style?",
      "options": [
        { "label": "Cozy", "value": "cozy" }
      ]
    }
  ]
}</create_preset>`;

describe("create_preset connected commands", () => {
  it("parses create_preset blocks", () => {
    const parsed = parseCharacterCommands(`Done.\n${createPresetBlock}`);

    expect(parsed.commands).toEqual([
      expect.objectContaining({
        type: "create_preset",
        name: "Story Preset",
        groups: [expect.objectContaining({ id: "tone", name: "Tone" })],
        sections: [expect.objectContaining({ identifier: "voice", groupId: "tone" })],
        choiceBlocks: [expect.objectContaining({ variableName: "style" })],
      }),
    ]);
    expect(parsed.cleanContent).toBe("Done.");
  });

  it("executes create_preset blocks into prompt preset rows", async () => {
    const storage = createStorage();

    const result = await persistConnectedCommandTags(
      storage,
      { id: "chat-1", mode: "conversation", metadata: {} },
      createPresetBlock,
    );

    const prompts = await storage.list<Row>("prompts");
    const groups = await storage.list<Row>("prompt-groups");
    const sections = await storage.list<Row>("prompt-sections");
    const variables = await storage.list<Row>("prompt-variables");

    expect(result.executedCommands).toEqual(["create_preset"]);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "assistant_action",
        data: expect.objectContaining({
          action: "preset_created",
          presetName: "Story Preset",
        }),
      }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(sections).toHaveLength(1);
    expect(variables).toHaveLength(1);
    expect(sections[0]).toEqual(expect.objectContaining({ presetId: prompts[0]?.id, groupId: groups[0]?.id }));
    expect(variables[0]).toEqual(expect.objectContaining({ presetId: prompts[0]?.id, variableName: "style" }));
  });
});

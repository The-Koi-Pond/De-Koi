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

function currentScheduleDayName(): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(new Date().getDay() + 6) % 7]!;
}

function nonCurrentScheduleDayName(): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].find(
    (day) => day !== currentScheduleDayName(),
  )!;
}

function commandStorage(args: {
  characters?: JsonRecord[];
  chats?: JsonRecord[];
  lorebooks: JsonRecord[];
  lorebookEntries: JsonRecord[];
  creates?: Array<{ entity: StorageEntity; value: JsonRecord }>;
  updates?: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }>;
  metadataPatches?: Array<{ chatId: string; patch: JsonRecord }>;
}): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      if (entity === "characters") return recordList<T>(args.characters ?? [], options);
      if (entity === "chats") return recordList<T>(args.chats ?? [], options);
      if (entity === "lorebooks") return recordList<T>(args.lorebooks, options);
      if (entity === "lorebook-entries") return recordList<T>(args.lorebookEntries, options);
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      const rows =
        entity === "characters"
          ? (args.characters ?? [])
          : entity === "chats"
            ? (args.chats ?? [])
            : entity === "lorebooks"
              ? args.lorebooks
              : entity === "lorebook-entries"
                ? args.lorebookEntries
                : [];
      return asStorageValue<T | null>(rows.find((row) => row.id === id) ?? null);
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `created-${args.creates?.length ?? 0}`, ...value };
      args.creates?.push({ entity, value: row });
      if (entity === "characters") args.characters?.push(row);
      if (entity === "lorebook-entries") args.lorebookEntries.push(row);
      return asStorageValue<T>(row);
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      args.updates?.push({ entity, id, patch });
      const rows =
        entity === "characters"
          ? (args.characters ?? [])
          : entity === "lorebooks"
            ? args.lorebooks
            : entity === "lorebook-entries"
              ? args.lorebookEntries
              : [];
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
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>) {
      args.metadataPatches?.push({ chatId, patch: patch as JsonRecord });
      const chat = args.chats?.find((row) => row.id === chatId);
      if (chat) {
        chat.metadata = { ...((chat.metadata as JsonRecord) ?? {}), ...patch };
      }
      return asStorageValue<T>(chat ?? {});
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

describe("character connected commands", () => {
  it("patches the current schedule block without replacing the weekly schedule shape", async () => {
    const days = Object.fromEntries(
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => [
        day,
        [{ time: "00:00-24:00", activity: "reading", status: "idle" }],
      ]),
    );
    const characters = [
      {
        id: "char-1",
        data: {
          name: "Mira",
          extensions: {
            conversationStatus: "idle",
            conversationActivity: "reading",
          },
        },
      },
    ];
    const nonCurrentDayName = nonCurrentScheduleDayName();
    const chats = [
      {
        id: "chat-2",
        mode: "conversation",
        characterIds: ["char-1"],
        metadata: {
          conversationSchedulesEnabled: true,
          characterSchedules: {
            "char-1": {
              weekStart: "2026-06-01T00:00:00.000Z",
              days: {
                ...days,
                [nonCurrentDayName]: [{ time: "00:00-24:00", activity: "local day", status: "online" }],
              },
              inactivityThresholdMinutes: 5,
              idleResponseDelayMinutes: 2,
              dndResponseDelayMinutes: 8,
              talkativeness: 25,
              localNote: "keep sibling metadata",
            },
          },
        },
      },
      {
        id: "chat-3",
        mode: "conversation",
        characterIds: ["char-1"],
        metadata: {
          conversationSchedulesEnabled: true,
          characterSchedules: {
            "char-1": {
              weekStart: "2026-06-15T00:00:00.000Z",
              days: {
                ...days,
                [currentScheduleDayName()]: [{ time: "00:00-00:00", activity: "closed", status: "offline" }],
              },
              inactivityThresholdMinutes: 15,
              talkativeness: 10,
            },
          },
        },
      },
    ];
    const metadataPatches: Array<{ chatId: string; patch: JsonRecord }> = [];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = commandStorage({
      characters,
      chats,
      lorebooks: [],
      lorebookEntries: [],
      metadataPatches,
      updates,
    });

    const result = await persistConnectedCommandTags(
      storage,
      {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["char-1"],
        metadata: {
          conversationSchedulesEnabled: true,
          characterSchedules: {
            "char-1": {
              weekStart: "2026-06-08T00:00:00.000Z",
              days,
              inactivityThresholdMinutes: 30,
              talkativeness: 70,
            },
          },
        },
      },
      '[schedule_update: status="dnd", activity="debugging"]',
    );

    expect(result.executedCommands).toEqual(["schedule_update"]);
    expect(metadataPatches).toHaveLength(2);
    expect(metadataPatches[0]?.chatId).toBe("chat-1");
    const schedules = metadataPatches[0]?.patch.characterSchedules as JsonRecord;
    const schedule = schedules["char-1"] as JsonRecord;
    expect(schedule).toMatchObject({
      weekStart: "2026-06-08T00:00:00.000Z",
      inactivityThresholdMinutes: 30,
      talkativeness: 70,
    });
    expect(schedule.days).toBeDefined();
    expect(schedule).not.toHaveProperty("duration");

    const dayName = currentScheduleDayName();
    expect((schedule.days as JsonRecord)[dayName]).toEqual([
      { time: "00:00-24:00", activity: "debugging", status: "dnd" },
    ]);

    expect(metadataPatches[1]?.chatId).toBe("chat-2");
    const siblingSchedules = metadataPatches[1]?.patch.characterSchedules as JsonRecord;
    const siblingSchedule = siblingSchedules["char-1"] as JsonRecord;
    expect(siblingSchedule).toMatchObject({
      weekStart: "2026-06-01T00:00:00.000Z",
      inactivityThresholdMinutes: 5,
      idleResponseDelayMinutes: 2,
      dndResponseDelayMinutes: 8,
      talkativeness: 25,
      localNote: "keep sibling metadata",
    });
    expect((siblingSchedule.days as JsonRecord)[dayName]).toEqual([
      { time: "00:00-24:00", activity: "debugging", status: "dnd" },
    ]);
    expect((siblingSchedule.days as JsonRecord)[nonCurrentDayName]).toEqual([
      { time: "00:00-24:00", activity: "local day", status: "online" },
    ]);
    expect(metadataPatches.some((patch) => patch.chatId === "chat-3")).toBe(false);

    const characterData = updates[0]?.patch.data as JsonRecord;
    expect(characterData.extensions).toMatchObject({
      conversationStatus: "dnd",
      conversationActivity: "debugging",
    });
  });

  it("updates character availability when no current schedule block can be patched", async () => {
    const characters = [
      {
        id: "char-1",
        data: {
          name: "Mira",
          extensions: {
            conversationStatus: "idle",
            conversationActivity: "reading",
          },
        },
      },
    ];
    const metadataPatches: Array<{ chatId: string; patch: JsonRecord }> = [];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = commandStorage({
      characters,
      lorebooks: [],
      lorebookEntries: [],
      metadataPatches,
      updates,
    });

    const result = await persistConnectedCommandTags(
      storage,
      {
        id: "chat-1",
        mode: "conversation",
        characterIds: ["char-1"],
        metadata: {
          conversationSchedulesEnabled: true,
          characterSchedules: {
            "char-1": {
              weekStart: "2026-06-08T00:00:00.000Z",
              days: {
                [currentScheduleDayName()]: [{ time: "00:00-00:00", activity: "closed", status: "offline" }],
              },
              inactivityThresholdMinutes: 30,
              talkativeness: 70,
            },
          },
        },
      },
      '[schedule_update: status="online", activity="available"]',
    );

    expect(result.executedCommands).toEqual(["schedule_update"]);
    expect(metadataPatches).toHaveLength(0);
    const characterData = updates[0]?.patch.data as JsonRecord;
    expect(characterData.extensions).toMatchObject({
      conversationStatus: "online",
      conversationActivity: "available",
      conversationStatusSource: "schedule",
    });
  });

  it("creates character extension fields under data.extensions", async () => {
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const storage = commandStorage({ characters: [], lorebooks: [], lorebookEntries: [], creates });

    const result = await persistConnectedCommandTags(
      storage,
      { id: "chat-1", mode: "conversation" },
      [
        '[create_character: name="Mira", backstory="Keeps city secrets", appearance="Silver coat"',
        'fav=true, world="Harbor Nine", depth_prompt="Protect civilians"',
        'depth_prompt_depth=7, depth_prompt_role="assistant"]',
      ].join(" "),
    );

    expect(result.executedCommands).toEqual(["create_character"]);
    expect(creates).toHaveLength(1);
    expect(creates[0]?.entity).toBe("characters");
    const data = creates[0]?.value.data as JsonRecord;
    expect(data).not.toHaveProperty("backstory");
    expect(data).not.toHaveProperty("appearance");
    expect(data).not.toHaveProperty("fav");
    expect(data).not.toHaveProperty("world");
    expect(data.extensions).toMatchObject({
      altDescriptions: [],
      backstory: "Keeps city secrets",
      appearance: "Silver coat",
      fav: true,
      world: "Harbor Nine",
      depth_prompt: {
        prompt: "Protect civilians",
        depth: 7,
        role: "assistant",
      },
    });
    expect(data.extensions).not.toHaveProperty("depth_prompt_depth");
    expect(data.extensions).not.toHaveProperty("depth_prompt_role");
  });

  it("updates character extension fields without writing top-level extension keys", async () => {
    const characters = [
      {
        id: "char-1",
        name: "Mira",
        data: {
          name: "Mira",
          description: "old description",
          extensions: {
            altDescriptions: [],
            backstory: "old backstory",
            appearance: "old appearance",
            fav: true,
            world: "old world",
            depth_prompt: {
              prompt: "old prompt",
              depth: 4,
              role: "system",
            },
          },
        },
      },
    ];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = commandStorage({ characters, lorebooks: [], lorebookEntries: [], updates });

    const result = await persistConnectedCommandTags(
      storage,
      { id: "chat-1", mode: "conversation" },
      [
        '[update_character: name="Mira", backstory="", appearance="Blue coat"',
        'fav=false, world="Harbor Ten", depth_prompt_depth=2]',
      ].join(" "),
    );

    expect(result.executedCommands).toEqual(["update_character"]);
    expect(updates).toHaveLength(1);
    const data = updates[0]?.patch.data as JsonRecord;
    expect(data).not.toHaveProperty("backstory");
    expect(data).not.toHaveProperty("appearance");
    expect(data).not.toHaveProperty("fav");
    expect(data).not.toHaveProperty("world");
    expect(data.extensions).toMatchObject({
      altDescriptions: [],
      backstory: "",
      appearance: "Blue coat",
      fav: false,
      world: "Harbor Ten",
      depth_prompt: {
        prompt: "old prompt",
        depth: 2,
        role: "system",
      },
    });
    expect(data.extensions).not.toHaveProperty("depth_prompt_depth");
    expect(data.extensions).not.toHaveProperty("depth_prompt_role");
  });

  it("migrates old top-level extension fields when updating command-created characters", async () => {
    const characters = [
      {
        id: "char-1",
        name: "Mira",
        data: {
          name: "Mira",
          backstory: "legacy backstory",
          appearance: "legacy appearance",
          fav: true,
          world: "Legacy Harbor",
          extensions: {
            altDescriptions: [],
            depth_prompt: "legacy prompt",
            depth_prompt_depth: "6",
            depth_prompt_role: "assistant",
          },
        },
      },
    ];
    const updates: Array<{ entity: StorageEntity; id: string; patch: JsonRecord }> = [];
    const storage = commandStorage({ characters, lorebooks: [], lorebookEntries: [], updates });

    const result = await persistConnectedCommandTags(
      storage,
      { id: "chat-1", mode: "conversation" },
      '[update_character: name="Mira", appearance="updated appearance", depth_prompt_depth=2]',
    );

    expect(result.executedCommands).toEqual(["update_character"]);
    expect(updates).toHaveLength(1);
    const data = updates[0]?.patch.data as JsonRecord;
    expect(data).not.toHaveProperty("backstory");
    expect(data).not.toHaveProperty("appearance");
    expect(data).not.toHaveProperty("fav");
    expect(data).not.toHaveProperty("world");
    expect(data).not.toHaveProperty("depth_prompt");
    expect(data).not.toHaveProperty("depth_prompt_depth");
    expect(data).not.toHaveProperty("depth_prompt_role");
    expect(data.extensions).toMatchObject({
      altDescriptions: [],
      backstory: "legacy backstory",
      appearance: "updated appearance",
      fav: true,
      world: "Legacy Harbor",
      depth_prompt: {
        prompt: "legacy prompt",
        depth: 2,
        role: "assistant",
      },
    });
    expect(data.extensions).not.toHaveProperty("depth_prompt_depth");
    expect(data.extensions).not.toHaveProperty("depth_prompt_role");
  });
});

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

import { describe, expect, it } from "vitest";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../capabilities/storage";
import { persistConnectedCommandTags, pruneConnectedConversationNotes } from "./connected-commands";
import { loadCharacters } from "./prompt-assembly";
import { parseCharacterCommands } from "../modes/chat/commands/character-commands";
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
  messages?: Array<{ chatId: string; value: JsonRecord }>;
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
      if (entity === "chats") args.chats?.push(row);
      if (entity === "lorebook-entries") args.lorebookEntries.push(row);
      return asStorageValue<T>(row);
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      args.updates?.push({ entity, id, patch });
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
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>) {
      if (!args.messages) throw new Error("createChatMessage should not be called");
      args.messages.push({ chatId, value });
      return asStorageValue<T>({ id: `message-${args.messages.length}`, ...value });
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
      return asStorageValue<T>(chat ?? { id: chatId, metadata: patch });
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

describe("connected conversation notes", () => {
  it("prunes older durable notes to the per-chat budget while preserving newest notes", () => {
    const notes = [
      {
        id: "old-connected",
        type: "note",
        content: "older connected durable note",
        sourceChatId: "conversation-1",
        targetChatId: "roleplay-1",
      },
      {
        id: "other-target",
        type: "note",
        content: "different target should not count",
        sourceChatId: "conversation-1",
        targetChatId: "roleplay-2",
      },
      {
        id: "influence",
        type: "influence",
        content: "queued influence is not a durable note",
        sourceChatId: "conversation-1",
        targetChatId: "roleplay-1",
      },
      {
        id: "new-connected",
        type: "note",
        content: "newest connected durable note",
        sourceChatId: "conversation-1",
        targetChatId: "roleplay-1",
      },
    ];

    expect(pruneConnectedConversationNotes(notes, "roleplay-1", 32).map((note) => note.id)).toEqual([
      "other-target",
      "influence",
      "new-connected",
    ]);
  });

  it("keeps the newest durable note even when it exceeds the budget by itself", () => {
    const notes = [
      { id: "old", type: "note", content: "old note", targetChatId: "roleplay-1" },
      { id: "new", type: "note", content: "new note longer than budget", targetChatId: "roleplay-1" },
    ];

    expect(pruneConnectedConversationNotes(notes, "roleplay-1", 4).map((note) => note.id)).toEqual(["new"]);
  });
});

describe("scene connected command parsing", () => {
  it("accepts model scene tags with curly quotes and alternate scenario keys", () => {
    const result = parseCharacterCommands(
      "Visible setup.\n[scene: description=\u201cA rainy rooftop confession\u201d, background=\u201ccity.png\u201d, plan=\u201cKeep it intimate.\u201d]",
    );

    expect(result.cleanContent).toBe("Visible setup.");
    expect(result.commands).toEqual([
      {
        type: "scene",
        scenario: "A rainy rooftop confession",
        background: "city.png",
        plan: "Keep it intimate.",
      },
    ]);
  });

  it("accepts bare scene premises inside explicit scene tags", () => {
    const result = parseCharacterCommands("Visible setup.\n[scene: A quiet shrine at dawn]");

    expect(result.cleanContent).toBe("Visible setup.");
    expect(result.commands).toEqual([{ type: "scene", scenario: "A quiet shrine at dawn" }]);
  });
});

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

  it("stores target-attributed memory commands as character memories and chat memory chunks", async () => {
    const chats: JsonRecord[] = [
      {
        id: "chat-1",
        name: "Mira conversation",
        mode: "conversation",
        characterIds: ["char-1"],
        memories: [
          {
            id: "existing-memory",
            chatId: "chat-1",
            content: "Memory for Mira: Existing fact.",
            messageCount: 0,
            createdAt: "2026-06-10T00:00:00.000Z",
          },
        ],
        notes: [],
        metadata: {},
      },
    ];
    const characters: JsonRecord[] = [{ id: "char-1", name: "Mira", data: { name: "Mira", extensions: {} } }];
    const storage = commandStorage({
      chats,
      characters,
      lorebooks: [],
      lorebookEntries: [],
    });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      'Visible reply.\n[memory: target="Mira", summary="[2026-06-11 10:00] User loves jasmine tea."]',
    );

    expect(result.displayContent).toBe("Visible reply.");
    expect(result.executedCommands).toEqual(["memory"]);
    expect(result.createdNotes).toEqual([]);
    expect(chats[0]?.notes).toEqual([]);
    expect(chats[0]?.memories).toHaveLength(2);
    expect((chats[0]?.memories as JsonRecord[])[1]).toMatchObject({
      chatId: "chat-1",
      content: "Memory for Mira: User loves jasmine tea.",
      messageCount: 0,
      messageIds: [],
      hasEmbedding: false,
      embeddingStatus: "unavailable",
      embeddingSource: "command",
      source: "connected_command",
      sourceChatId: "chat-1",
      commandMemoryKey: expect.any(String),
      target: "Mira",
      targetCharacterName: "Mira",
      targetCharacterId: "char-1",
    });
    const extensions = (characters[0]?.data as JsonRecord).extensions as JsonRecord;
    expect(extensions.characterMemories).toMatchObject([
      {
        from: "Mira conversation",
        fromCharId: "char-1",
        sourceChatId: "chat-1",
        commandMemoryId: expect.any(String),
        commandMemoryKey: expect.any(String),
        summary: "User loves jasmine tea.",
      },
    ]);
    const memories = extensions.characterMemories as JsonRecord[];
    memories.push(
      { from: "Old", summary: "Yesterday memory.", createdAt: "2026-06-10T00:00:00.000Z" },
      { from: "Unknown", summary: "Missing date memory." },
      { from: "Bad", summary: "Malformed date memory.", createdAt: "not-a-date" },
    );

    const [characterContext] = await loadCharacters(storage, chats[0]!);
    expect(characterContext?.memories).toEqual(
      expect.arrayContaining([expect.stringContaining("User loves jasmine tea.")]),
    );
    expect(characterContext?.memories?.join("\n")).not.toContain("Yesterday memory.");
    expect(characterContext?.memories?.join("\n")).not.toContain("Missing date memory.");
    expect(characterContext?.memories?.join("\n")).not.toContain("Malformed date memory.");
  });

  it("accepts bare target memory commands without leaking hidden command text", async () => {
    const chats: JsonRecord[] = [
      {
        id: "chat-1",
        name: "Mira conversation",
        mode: "conversation",
        characterIds: ["char-1"],
        memories: [],
        notes: [],
        metadata: {},
      },
    ];
    const characters: JsonRecord[] = [{ id: "char-1", name: "Mira", data: { name: "Mira", extensions: {} } }];
    const storage = commandStorage({
      chats,
      characters,
      lorebooks: [],
      lorebookEntries: [],
    });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      '[memory: Mira, "Mira remembers Charlotte is protective of Victor."]She keeps an eye on him.',
    );

    expect(result.displayContent).toBe("She keeps an eye on him.");
    expect(result.executedCommands).toEqual(["memory"]);
    expect(chats[0]?.memories).toHaveLength(1);
    expect((chats[0]?.memories as JsonRecord[])[0]).toMatchObject({
      content: "Memory for Mira: Mira remembers Charlotte is protective of Victor.",
      target: "Mira",
      targetCharacterName: "Mira",
      targetCharacterId: "char-1",
    });
  });

  it("does not leave duplicate character memories when a command memory write is retried", async () => {
    const chats: JsonRecord[] = [
      {
        id: "chat-1",
        name: "Mira conversation",
        mode: "conversation",
        characterIds: ["char-1"],
        memories: [],
        metadata: {},
      },
    ];
    const characters: JsonRecord[] = [{ id: "char-1", name: "Mira", data: { name: "Mira", extensions: {} } }];
    const storage = commandStorage({
      chats,
      characters,
      lorebooks: [],
      lorebookEntries: [],
    });
    const update = storage.update.bind(storage);
    let failChatUpdate = true;
    storage.update = async <T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>) => {
      if (entity === "chats" && failChatUpdate) throw new Error("chat write failed");
      return update<T>(entity, id, patch);
    };
    const command = '[memory: target="Mira", summary="User loves jasmine tea."]';

    const failed = await persistConnectedCommandTags(storage, chats[0]!, command);

    expect(failed.executedCommands).toEqual([]);
    expect(failed.events).toMatchObject([{ type: "command_error" }]);
    expect(chats[0]?.memories).toEqual([]);
    expect(((characters[0]?.data as JsonRecord).extensions as JsonRecord).characterMemories).toBeUndefined();

    failChatUpdate = false;
    const firstRetry = await persistConnectedCommandTags(storage, chats[0]!, command);
    const secondRetry = await persistConnectedCommandTags(storage, chats[0]!, command);

    expect(firstRetry.executedCommands).toEqual(["memory"]);
    expect(secondRetry.executedCommands).toEqual(["memory"]);
    expect(chats[0]?.memories).toHaveLength(1);
    const extensions = (characters[0]?.data as JsonRecord).extensions as JsonRecord;
    expect(extensions.characterMemories).toHaveLength(1);
  });

  it("keeps valid DM message text visible when the target character is missing", async () => {
    const chats = [
      {
        id: "roleplay-1",
        name: "Roleplay",
        mode: "roleplay",
        characterIds: ["speaker-1"],
        folderId: "folder-1",
        metadata: { roleplayDmCommandsEnabled: true },
      },
    ];
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const messages: Array<{ chatId: string; value: JsonRecord }> = [];
    const storage = commandStorage({ chats, lorebooks: [], lorebookEntries: [], creates, messages });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      'Visible narration.\n[dm: character="Cardless", message="Fallback text."]',
    );

    expect(result.displayContent).toBe("Visible narration.\nFallback text.");
    expect(result.executedCommands).toEqual([]);
    expect(result.events).toEqual([]);
    expect(creates).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("creates a metadata-scoped DM thread instead of reusing a generic conversation", async () => {
    const characters = [{ id: "bob-1", name: "Bob", data: { name: "Bob" } }];
    const chats = [
      {
        id: "roleplay-1",
        name: "Roleplay",
        mode: "roleplay",
        characterIds: ["speaker-1"],
        folderId: "folder-1",
        metadata: { roleplayDmCommandsEnabled: true },
      },
      {
        id: "generic-bob",
        name: "Bob",
        mode: "conversation",
        characterIds: ["bob-1"],
        metadata: {},
      },
    ];
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const messages: Array<{ chatId: string; value: JsonRecord }> = [];
    const storage = commandStorage({ characters, chats, lorebooks: [], lorebookEntries: [], creates, messages });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      'Visible narration.\n[dm: character="Bob", message="Secret text."]',
    );

    expect(result.displayContent).toBe("Visible narration.");
    expect(result.executedCommands).toEqual(["dm"]);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      entity: "chats",
      value: {
        name: "Bob",
        mode: "conversation",
        characterIds: ["bob-1"],
        folderId: "folder-1",
        metadata: {
          roleplayDmThread: true,
          dmOriginChatId: "roleplay-1",
          dmTargetCharacterId: "bob-1",
        },
      },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      chatId: "created-0",
      value: { role: "assistant", characterId: "bob-1", content: "Secret text." },
    });
    expect(result.events[0]).toMatchObject({
      type: "ooc_posted",
      data: {
        chatId: "created-0",
        roleplayDmThread: true,
        sourceChatId: "roleplay-1",
        targetCharacterId: "bob-1",
      },
    });
  });

  it("keeps command-shaped DM payload text out of source command parsing", async () => {
    const characters = [{ id: "bob-1", name: "Bob", data: { name: "Bob" } }];
    const chats = [
      {
        id: "roleplay-1",
        name: "Roleplay",
        mode: "roleplay",
        characterIds: ["speaker-1"],
        folderId: "folder-1",
        metadata: { roleplayDmCommandsEnabled: true },
      },
    ];
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const messages: Array<{ chatId: string; value: JsonRecord }> = [];
    const storage = commandStorage({ characters, chats, lorebooks: [], lorebookEntries: [], creates, messages });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      'Visible narration.\n[dm: character="Bob", message="Secret [selfie] <note>plain text</note>."]',
    );

    expect(result.displayContent).toBe("Visible narration.");
    expect(result.executedCommands).toEqual(["dm"]);
    expect(result.createdNotes).toEqual([]);
    expect(result.assistantAttachments).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      chatId: "created-0",
      value: { role: "assistant", characterId: "bob-1", content: "Secret [selfie] <note>plain text</note>." },
    });
  });

  it("reuses and tags a linked conversation for the resolved target", async () => {
    const characters = [{ id: "bob-1", name: "Bob", data: { name: "Bob" } }];
    const chats = [
      {
        id: "roleplay-1",
        name: "Roleplay",
        mode: "roleplay",
        connectedChatId: "linked-bob",
        characterIds: ["speaker-1"],
        folderId: "folder-1",
        metadata: { roleplayDmCommandsEnabled: true },
      },
      {
        id: "linked-bob",
        name: "Bob DM",
        mode: "conversation",
        characterIds: ["bob-1"],
        metadata: {},
      },
    ];
    const creates: Array<{ entity: StorageEntity; value: JsonRecord }> = [];
    const messages: Array<{ chatId: string; value: JsonRecord }> = [];
    const metadataPatches: Array<{ chatId: string; patch: JsonRecord }> = [];
    const storage = commandStorage({
      characters,
      chats,
      lorebooks: [],
      lorebookEntries: [],
      creates,
      messages,
      metadataPatches,
    });

    const result = await persistConnectedCommandTags(
      storage,
      chats[0]!,
      '[dm: character="Bob", message="Linked text."]',
    );

    expect(result.displayContent).toBe("");
    expect(result.suppressAssistantMessage).toBe(true);
    expect(creates).toEqual([]);
    expect(metadataPatches).toEqual([
      {
        chatId: "linked-bob",
        patch: {
          roleplayDmThread: true,
          dmOriginChatId: "roleplay-1",
          dmTargetCharacterId: "bob-1",
        },
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      chatId: "linked-bob",
      value: { role: "assistant", characterId: "bob-1", content: "Linked text." },
    });
  });
});

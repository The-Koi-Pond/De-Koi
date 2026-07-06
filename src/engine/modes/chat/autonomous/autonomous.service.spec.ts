import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway, StorageListOptions } from "../../../capabilities/storage";
import { getMonday, type ConversationRoutine, type WeekSchedule } from "../schedules/schedule.service";
import { getConversationStatus } from "./autonomous.service";

type JsonRecord = Record<string, unknown>;
type StorageCallLog = {
  gets: Array<{ entity: StorageEntity; id: string }>;
  lists: Array<{ entity: StorageEntity; options?: StorageListOptions }>;
  updates: Array<{ entity: StorageEntity; id: string; patch: Record<string, unknown> }>;
};
type TestStorageGateway = StorageGateway & { calls: StorageCallLog };

function storageGateway(records: { chats: JsonRecord[]; characters: JsonRecord[] }): TestStorageGateway {
  const rows: Partial<Record<StorageEntity, JsonRecord[]>> = {
    chats: records.chats,
    characters: records.characters,
  };
  const calls: StorageCallLog = { gets: [], lists: [], updates: [] };

  return {
    calls,
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      calls.lists.push({ entity, options });
      if (options?.whereIn) {
        const { field, values } = options.whereIn;
        const selected = new Set(values);
        return (rows[entity] ?? []).filter((record) => selected.has(String(record[field]))) as T[];
      }
      return (rows[entity] ?? []) as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      calls.gets.push({ entity, id });
      return ((rows[entity] ?? []).find((record) => record.id === id) ?? null) as T | null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      calls.updates.push({ entity, id, patch });
      const record = (rows[entity] ?? []).find((item) => item.id === id);
      if (record) Object.assign(record, patch);
      return { id, ...record, ...patch } as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>() {
      return [] as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(_chatId: string, value: Record<string, unknown>) {
      return value as T;
    },
    async updateChatMessage<T = unknown>(_messageId: string, patch: Record<string, unknown>) {
      return patch as T;
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
    async patchChatMetadata<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async patchChatSummaries<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState<T = unknown>() {
      return {} as T;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Record<string, unknown>) {
      return snapshot as T;
    },
    async listLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async promptFull() {
      return null;
    },
  };
}

function allDaySchedule(activity: string, status: "online" | "idle" | "dnd" | "offline"): WeekSchedule {
  const block = { time: "00:00-23:59", activity, status };
  return {
    weekStart: getMonday().toISOString(),
    inactivityThresholdMinutes: 60,
    talkativeness: 50,
    days: {
      Monday: [block],
      Tuesday: [block],
      Wednesday: [block],
      Thursday: [block],
      Friday: [block],
      Saturday: [block],
      Sunday: [block],
    },
  };
}

function alwaysBusyRoutine(): ConversationRoutine {
  return {
    weekStart: getMonday().toISOString(),
    generatedAt: new Date().toISOString(),
    sleep: "Keeps flexible hours.",
    busy: [{ when: "mornings afternoons evenings late night", summary: "classes", availability: "busy" }],
    freeish: ["quiet evenings"],
    replyStyle: "Slow when in class.",
    checkInStyle: "Likes texting at night.",
    socialEnergy: { level: "medium", reason: "Warm but focused." },
    inactivityThresholdMinutes: 45,
    talkativeness: 70,
  };
}
describe("getConversationStatus", () => {
  it("uses fuzzy routines before legacy schedules when reporting conversation status", async () => {
    const routine = alwaysBusyRoutine();
    const legacySchedule = allDaySchedule("legacy free time", "online");
    const storage = storageGateway({
      chats: [
        {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterRoutines: { "char-1": routine },
            characterSchedules: { "char-1": legacySchedule },
          },
        },
      ],
      characters: [{ id: "char-1", data: { extensions: {} } }],
    });

    const result = await getConversationStatus(storage, "chat-1");

    expect(result.statuses["char-1"]).toMatchObject({
      status: "dnd",
      activity: "classes",
      routine,
      availabilityExplanation: {
        label: "Busy",
        detail: "classes",
        message: "Busy: classes.",
      },
    });
    await expect(storage.get<JsonRecord>("characters", "char-1")).resolves.toMatchObject({
      data: {
        extensions: {
          conversationStatus: "dnd",
          conversationActivity: "classes",
          conversationStatusSource: "routine",
        },
      },
    });
  });

  it("returns a plain-language availability explanation with each status row", async () => {
    const schedule = allDaySchedule("in class", "dnd");
    const storage = storageGateway({
      chats: [
        {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: { "char-1": schedule },
          },
        },
      ],
      characters: [{ id: "char-1", data: { extensions: {} } }],
    });

    const result = await getConversationStatus(storage, "chat-1");

    expect(result.statuses["char-1"]).toMatchObject({
      status: "dnd",
      activity: "in class",
      availabilityExplanation: {
        label: "Busy",
        detail: "in class",
        message: "Busy: in class.",
      },
    });
  });
  it("keeps fallback availability response-only when a character has no schedule", async () => {
    const storage = storageGateway({
      chats: [
        {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: {},
          },
        },
      ],
      characters: [
        {
          id: "char-1",
          data: {
            extensions: {
              conversationStatus: "offline",
              conversationActivity: "asleep",
              conversationStatusSource: "schedule",
              conversationAvailabilityExplanation: "Unavailable: asleep.",
            },
          },
        },
      ],
    });

    const result = await getConversationStatus(storage, "chat-1");

    expect(result.statuses["char-1"]).toMatchObject({
      status: "online",
      activity: "unknown (no schedule)",
      availabilityExplanation: {
        label: "Available",
        detail: "unknown (no schedule)",
        message: "Available: unknown (no schedule).",
      },
    });
    const character = await storage.get<JsonRecord>("characters", "char-1");
    const extensions = ((character?.data as JsonRecord | undefined)?.extensions ?? {}) as JsonRecord;
    expect(extensions.conversationStatus).toBeUndefined();
    expect(extensions.conversationActivity).toBeUndefined();
    expect(extensions.conversationStatusSource).toBeUndefined();
    expect(extensions.conversationAvailabilityExplanation).toBeUndefined();

    const schedule = allDaySchedule("commuting", "idle");
    await storage.update("chats", "chat-1", {
      metadata: {
        conversationSchedulesEnabled: true,
        characterSchedules: { "char-1": schedule },
      },
    });
    await getConversationStatus(storage, "chat-1");

    await expect(storage.get<JsonRecord>("characters", "char-1")).resolves.toMatchObject({
      data: {
        extensions: {
          conversationStatus: "idle",
          conversationActivity: "commuting",
          conversationStatusSource: "schedule",
          conversationAvailabilityExplanation: "Delayed: commuting.",
        },
      },
    });
  });
  it("syncs the plain-language availability explanation into character extensions", async () => {
    const schedule = allDaySchedule("commuting", "idle");
    const storage = storageGateway({
      chats: [
        {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["char-1"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: { "char-1": schedule },
          },
        },
      ],
      characters: [{ id: "char-1", data: { extensions: {} } }],
    });

    await getConversationStatus(storage, "chat-1");

    await expect(storage.get<JsonRecord>("characters", "char-1")).resolves.toMatchObject({
      data: {
        extensions: {
          conversationStatus: "idle",
          conversationActivity: "commuting",
          conversationStatusSource: "schedule",
          conversationAvailabilityExplanation: "Delayed: commuting.",
        },
      },
    });
  });
  it("batch-loads character rows before syncing status for single-character and group chats", async () => {
    const singleSchedule = allDaySchedule("reading", "online");
    const groupSchedule = allDaySchedule("commuting", "idle");
    const groupRoutine = alwaysBusyRoutine();
    const storage = storageGateway({
      chats: [
        {
          id: "single-chat",
          mode: "conversation",
          characterIds: ["single-char"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: { "single-char": singleSchedule },
          },
        },
        {
          id: "group-chat",
          mode: "conversation",
          characterIds: ["group-char-1", "group-char-2", "group-char-1"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: { "group-char-1": groupSchedule },
            characterRoutines: { "group-char-2": groupRoutine },
          },
        },
      ],
      characters: [
        { id: "single-char", data: { extensions: {} } },
        { id: "group-char-1", data: { extensions: {} } },
        { id: "group-char-2", data: { extensions: {} } },
      ],
    });

    const singleResult = await getConversationStatus(storage, "single-chat");
    const groupResult = await getConversationStatus(storage, "group-chat");

    expect(singleResult.persistedCharacterIds).toEqual(["single-char"]);
    expect(groupResult.persistedCharacterIds).toEqual(["group-char-1", "group-char-2"]);

    expect(storage.calls.lists.filter((call) => call.entity === "characters")).toEqual([
      {
        entity: "characters",
        options: { whereIn: { field: "id", values: ["single-char"] } },
      },
      {
        entity: "characters",
        options: { whereIn: { field: "id", values: ["group-char-1", "group-char-2"] } },
      },
    ]);
    expect(storage.calls.gets.filter((call) => call.entity === "characters")).toEqual([]);
    expect(storage.calls.updates.filter((call) => call.entity === "characters").map((call) => call.id)).toEqual([
      "single-char",
      "group-char-1",
      "group-char-2",
    ]);
  });

  it("coalesces concurrent status refreshes for the same chat", async () => {
    const schedule = allDaySchedule("reading logs", "online");
    const routine = alwaysBusyRoutine();
    const storage = storageGateway({
      chats: [
        {
          id: "group-chat",
          mode: "conversation",
          characterIds: ["char-a", "char-b", "char-a"],
          metadata: {
            conversationSchedulesEnabled: true,
            characterSchedules: { "char-a": schedule },
            characterRoutines: { "char-b": routine },
          },
        },
      ],
      characters: [
        { id: "char-a", data: { extensions: {} } },
        { id: "char-b", data: { extensions: {} } },
      ],
    });

    const [first, second] = await Promise.all([
      getConversationStatus(storage, "group-chat"),
      getConversationStatus(storage, "group-chat"),
    ]);

    expect(second).toBe(first);
    expect(storage.calls.lists.filter((call) => call.entity === "characters")).toEqual([
      {
        entity: "characters",
        options: { whereIn: { field: "id", values: ["char-a", "char-b"] } },
      },
    ]);
    expect(storage.calls.updates.filter((call) => call.entity === "characters").map((call) => call.id)).toEqual([
      "char-a",
      "char-b",
    ]);
  });
});

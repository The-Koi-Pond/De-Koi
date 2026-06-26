import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../../../capabilities/storage";
import { getMonday, type WeekSchedule } from "../schedules/schedule.service";
import { getConversationStatus } from "./autonomous.service";

type JsonRecord = Record<string, unknown>;

function storageGateway(records: { chats: JsonRecord[]; characters: JsonRecord[] }): StorageGateway {
  const rows: Partial<Record<StorageEntity, JsonRecord[]>> = {
    chats: records.chats,
    characters: records.characters,
  };

  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      return (rows[entity] ?? []) as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      return ((rows[entity] ?? []).find((record) => record.id === id) ?? null) as T | null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
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
describe("getConversationStatus", () => {
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
  it("syncs fallback availability when a character has no schedule", async () => {
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
    await expect(storage.get<JsonRecord>("characters", "char-1")).resolves.toMatchObject({
      data: {
        extensions: {
          conversationStatus: "online",
          conversationActivity: "unknown (no schedule)",
          conversationAvailabilityExplanation: "Available: unknown (no schedule).",
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
          conversationAvailabilityExplanation: "Delayed: commuting.",
        },
      },
    });
  });
});

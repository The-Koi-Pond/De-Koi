import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../../capabilities/storage";

import {
  getAvailabilityAutonomousPolicy,
  getAvailabilityDecision,
  generateConversationSchedules,
  getAvailabilityExplanation,
  getAvailabilityResponseDelay,
  type WeekSchedule,
} from "./schedule.service";

const baseSchedule: WeekSchedule = {
  weekStart: "2026-06-22T00:00:00.000Z",
  inactivityThresholdMinutes: 60,
  talkativeness: 50,
  days: {
    Monday: [],
    Tuesday: [
      { time: "09:00-10:00", activity: "free time", status: "online" },
      { time: "10:00-11:00", activity: "commuting", status: "idle" },
      { time: "11:00-12:00", activity: "in class", status: "dnd" },
      { time: "12:00-13:00", activity: "sleeping", status: "offline" },
    ],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  },
};

function tuesdayAt(hour: number, minute = 0): Date {
  return new Date(2026, 5, 23, hour, minute, 0, 0);
}

describe("getAvailabilityDecision", () => {
  it("treats online schedule blocks as immediately available", () => {
    expect(getAvailabilityDecision(baseSchedule, tuesdayAt(9, 30))).toMatchObject({
      source: "schedule",
      status: "online",
      activity: "free time",
      availability: "available",
      canReplyNow: true,
      canMessageFirst: true,
      delayKind: "none",
      reason: "free time",
    });
  });

  it("treats idle and dnd schedule blocks as delayed rather than unavailable", () => {
    expect(getAvailabilityDecision(baseSchedule, tuesdayAt(10, 30))).toMatchObject({
      status: "idle",
      availability: "delayed",
      canReplyNow: false,
      canMessageFirst: true,
      delayKind: "short",
      reason: "commuting",
    });
    expect(getAvailabilityDecision(baseSchedule, tuesdayAt(11, 30))).toMatchObject({
      status: "dnd",
      availability: "delayed",
      canReplyNow: false,
      canMessageFirst: true,
      delayKind: "long",
      reason: "in class",
    });
  });

  it("treats offline schedule blocks as unavailable", () => {
    expect(getAvailabilityDecision(baseSchedule, tuesdayAt(12, 30))).toMatchObject({
      status: "offline",
      activity: "sleeping",
      availability: "unavailable",
      canReplyNow: false,
      canMessageFirst: false,
      delayKind: "blocked",
      reason: "sleeping",
    });
  });

  it("falls back to available when no schedule exists", () => {
    expect(getAvailabilityDecision(null, tuesdayAt(12, 30), "no routine")).toEqual({
      source: "fallback",
      status: "online",
      activity: "no routine",
      availability: "available",
      canReplyNow: true,
      canMessageFirst: true,
      delayKind: "none",
      reason: "no routine",
    });
  });

  it("uses availability decisions to preserve configured busy delays", () => {
    const schedule: WeekSchedule = {
      ...baseSchedule,
      idleResponseDelayMinutes: 7,
      dndResponseDelayMinutes: 42,
    };

    expect(getAvailabilityResponseDelay(getAvailabilityDecision(schedule, tuesdayAt(9, 30)), schedule)).toBe(0);
    expect(getAvailabilityResponseDelay(getAvailabilityDecision(schedule, tuesdayAt(10, 30)), schedule)).toBe(
      7 * 60 * 1000,
    );
    expect(getAvailabilityResponseDelay(getAvailabilityDecision(schedule, tuesdayAt(11, 30)), schedule)).toBe(
      42 * 60 * 1000,
    );
    expect(getAvailabilityResponseDelay(getAvailabilityDecision(schedule, tuesdayAt(12, 30)), schedule)).toBe(0);
  });

  it("uses mention delays for urgent availability decisions", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(
        getAvailabilityResponseDelay(getAvailabilityDecision(baseSchedule, tuesdayAt(9, 30)), baseSchedule, true),
      ).toBe(0);
      expect(
        getAvailabilityResponseDelay(getAvailabilityDecision(baseSchedule, tuesdayAt(10, 30)), baseSchedule, true),
      ).toBe(5 * 1000);
      expect(
        getAvailabilityResponseDelay(getAvailabilityDecision(baseSchedule, tuesdayAt(11, 30)), baseSchedule, true),
      ).toBe(30 * 1000);
      expect(
        getAvailabilityResponseDelay(getAvailabilityDecision(baseSchedule, tuesdayAt(12, 30)), baseSchedule, true),
      ).toBe(0);
    } finally {
      random.mockRestore();
    }
  });

  it("maps availability decisions to autonomous message eligibility", () => {
    expect(getAvailabilityAutonomousPolicy(getAvailabilityDecision(baseSchedule, tuesdayAt(9, 30)))).toEqual({
      canMessageFirst: true,
      canJoinCharacterExchange: true,
      inactivityThresholdMultiplier: 1,
    });
    expect(getAvailabilityAutonomousPolicy(getAvailabilityDecision(baseSchedule, tuesdayAt(10, 30)))).toEqual({
      canMessageFirst: true,
      canJoinCharacterExchange: true,
      inactivityThresholdMultiplier: 1,
    });
    expect(getAvailabilityAutonomousPolicy(getAvailabilityDecision(baseSchedule, tuesdayAt(11, 30)))).toEqual({
      canMessageFirst: true,
      canJoinCharacterExchange: false,
      inactivityThresholdMultiplier: 3,
    });
    expect(getAvailabilityAutonomousPolicy(getAvailabilityDecision(baseSchedule, tuesdayAt(12, 30)))).toEqual({
      canMessageFirst: false,
      canJoinCharacterExchange: false,
      inactivityThresholdMultiplier: Infinity,
    });
  });
  it("explains availability decisions in plain language", () => {
    expect(getAvailabilityExplanation(getAvailabilityDecision(baseSchedule, tuesdayAt(9, 30)))).toEqual({
      label: "Available",
      detail: "free time",
      message: "Available: free time.",
    });
    expect(getAvailabilityExplanation(getAvailabilityDecision(baseSchedule, tuesdayAt(10, 30)))).toEqual({
      label: "Delayed",
      detail: "commuting",
      message: "Delayed: commuting.",
    });
    expect(getAvailabilityExplanation(getAvailabilityDecision(baseSchedule, tuesdayAt(11, 30)))).toEqual({
      label: "Busy",
      detail: "in class",
      message: "Busy: in class.",
    });
    expect(getAvailabilityExplanation(getAvailabilityDecision(baseSchedule, tuesdayAt(12, 30)))).toEqual({
      label: "Unavailable",
      detail: "sleeping",
      message: "Unavailable: sleeping.",
    });
    expect(getAvailabilityExplanation(getAvailabilityDecision(null, tuesdayAt(12, 30), ""))).toEqual({
      label: "Available",
      detail: "free time",
      message: "Available: free time.",
    });
  });
});

type JsonRecord = Record<string, unknown>;

function generatedAvailabilityScheduleJson(): string {
  const blocks = [
    { time: "00:00-06:00", activity: "dreaming", availability: "unavailable" },
    { time: "06:00-09:00", activity: "breakfast", availability: "delayed" },
    { time: "09:00-17:00", activity: "focused research", availability: "busy" },
    { time: "17:00-23:59", activity: "open chat", availability: "available" },
  ];
  return JSON.stringify({
    talkativeness: 65,
    inactivityThresholdMinutes: 45,
    days: {
      Monday: blocks,
      Tuesday: blocks,
      Wednesday: blocks,
      Thursday: blocks,
      Friday: blocks,
      Saturday: blocks,
      Sunday: blocks,
    },
  });
}

function llmWithSchedule(content: string): LlmGateway & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request: LlmRequest): Promise<string> {
      requests.push(request);
      return content;
    },
    async *stream() {},
    async listModels() {
      return [];
    },
  };
}

function scheduleStorageGateway(): StorageGateway {
  const rows: Partial<Record<StorageEntity, JsonRecord[]>> = {
    chats: [
      {
        id: "chat-1",
        mode: "conversation",
        connectionId: "conn-1",
        characterIds: ["char-1"],
        metadata: {},
      },
    ],
    characters: [
      {
        id: "char-1",
        data: {
          name: "Mira",
          description: "A focused researcher.",
          personality: "Warm but serious.",
          extensions: {},
        },
      },
    ],
    connections: [{ id: "conn-1", model: "test-model" }],
    lorebooks: [],
    "lorebook-entries": [],
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
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>) {
      const chat = rows.chats?.find((record) => record.id === chatId);
      if (chat) chat.metadata = patch;
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

describe("generateConversationSchedules availability output", () => {
  it("accepts availability labels from the LLM while saving legacy schedule statuses", async () => {
    const storage = scheduleStorageGateway();
    const llm = llmWithSchedule(generatedAvailabilityScheduleJson());

    const result = await generateConversationSchedules({ storage, llm }, { chatId: "chat-1", forceRefresh: true });

    expect(result.schedules["char-1"]?.days.Monday).toEqual([
      { time: "00:00-06:00", activity: "dreaming", status: "offline" },
      { time: "06:00-09:00", activity: "breakfast", status: "idle" },
      { time: "09:00-17:00", activity: "focused research", status: "dnd" },
      { time: "17:00-23:59", activity: "open chat", status: "online" },
    ]);
  });
  it("rejects conflicting availability and legacy status rows", async () => {
    const storage = scheduleStorageGateway();
    const blocks = [{ time: "09:00-17:00", activity: "focused research", availability: "busy", status: "online" }];
    const llm = llmWithSchedule(
      JSON.stringify({
        talkativeness: 65,
        inactivityThresholdMinutes: 45,
        days: {
          Monday: blocks,
          Tuesday: blocks,
          Wednesday: blocks,
          Thursday: blocks,
          Friday: blocks,
          Saturday: blocks,
          Sunday: blocks,
        },
      }),
    );

    await expect(
      generateConversationSchedules({ storage, llm }, { chatId: "chat-1", forceRefresh: true }),
    ).rejects.toThrow("Schedule block availability/status mismatch");
  });

  it("rejects invalid availability labels instead of falling back to legacy status", async () => {
    const storage = scheduleStorageGateway();
    const blocks = [{ time: "09:00-17:00", activity: "focused research", availability: "maybe", status: "online" }];
    const llm = llmWithSchedule(
      JSON.stringify({
        talkativeness: 65,
        inactivityThresholdMinutes: 45,
        days: {
          Monday: blocks,
          Tuesday: blocks,
          Wednesday: blocks,
          Thursday: blocks,
          Friday: blocks,
          Saturday: blocks,
          Sunday: blocks,
        },
      }),
    );

    await expect(
      generateConversationSchedules({ storage, llm }, { chatId: "chat-1", forceRefresh: true }),
    ).rejects.toThrow("Schedule block has unsupported availability");
  });
  it("supports mixed availability and status-only schedule rows", async () => {
    const storage = scheduleStorageGateway();
    const blocks = [
      { time: "09:00-12:00", activity: "breakfast", availability: "delayed" },
      { time: "12:00-17:00", activity: "focused research", status: "offline" },
    ];
    const llm = llmWithSchedule(
      JSON.stringify({
        talkativeness: 65,
        inactivityThresholdMinutes: 45,
        days: {
          Monday: blocks,
          Tuesday: blocks,
          Wednesday: blocks,
          Thursday: blocks,
          Friday: blocks,
          Saturday: blocks,
          Sunday: blocks,
        },
      }),
    );

    const result = await generateConversationSchedules({ storage, llm }, { chatId: "chat-1", forceRefresh: true });

    expect(result.schedules["char-1"]?.days.Monday).toEqual([
      { time: "09:00-12:00", activity: "breakfast", status: "idle" },
      { time: "12:00-17:00", activity: "focused research", status: "offline" },
    ]);
  });
});

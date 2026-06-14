import { describe, expect, it, vi } from "vitest";
import type { StorageGateway } from "../../../capabilities/storage";
import { getMonday, type WeekSchedule } from "../schedules/schedule.service";
import { getConversationStatus } from "./autonomous.service";

function scheduleForWeek(weekStart: Date): WeekSchedule {
  return {
    weekStart: weekStart.toISOString(),
    days: {
      Monday: [{ time: "00:00-23:59", activity: "available", status: "online" }],
    },
    inactivityThresholdMinutes: 60,
    talkativeness: 50,
  };
}

describe("getConversationStatus", () => {
  it("reports stale schedules as needing refresh", async () => {
    const staleMonday = new Date(getMonday());
    staleMonday.setDate(staleMonday.getDate() - 7);
    const storage = {
      get: vi.fn(async (entity: string, id: string) =>
        entity === "chats" && id === "chat-1"
          ? {
              id,
              mode: "conversation",
              characterIds: ["char-1"],
              metadata: {
                conversationSchedulesEnabled: true,
                characterSchedules: { "char-1": scheduleForWeek(staleMonday) },
              },
            }
          : null,
      ),
      list: vi.fn(async () => []),
      patchChatMetadata: vi.fn(),
      update: vi.fn(),
    } as Partial<StorageGateway> as StorageGateway;

    const result = await getConversationStatus(storage, "chat-1");

    expect(result.needsRefresh).toBe(true);
  });

  it("inherits fresh sibling conversation schedules before reporting freshness", async () => {
    const staleMonday = new Date(getMonday());
    staleMonday.setDate(staleMonday.getDate() - 7);
    const freshSchedule = scheduleForWeek(getMonday());
    const patchChatMetadata = vi.fn();
    const storage = {
      get: vi.fn(async (entity: string, id: string) =>
        entity === "chats" && id === "chat-1"
          ? {
              id,
              mode: "conversation",
              characterIds: ["char-1"],
              metadata: {
                conversationSchedulesEnabled: true,
                characterSchedules: { "char-1": scheduleForWeek(staleMonday) },
              },
            }
          : null,
      ),
      list: vi.fn(async (entity: string) =>
        entity === "chats"
          ? [
              {
                id: "chat-1",
                mode: "conversation",
                characterIds: ["char-1"],
                metadata: {
                  conversationSchedulesEnabled: true,
                  characterSchedules: { "char-1": scheduleForWeek(staleMonday) },
                },
              },
              {
                id: "chat-2",
                mode: "conversation",
                characterIds: ["char-1"],
                metadata: {
                  conversationSchedulesEnabled: true,
                  characterSchedules: { "char-1": freshSchedule },
                },
              },
            ]
          : [],
      ),
      patchChatMetadata,
      update: vi.fn(),
    } as Partial<StorageGateway> as StorageGateway;

    const result = await getConversationStatus(storage, "chat-1");

    expect(result.needsRefresh).toBe(false);
    expect(result.statuses["char-1"]?.schedule).toBe(freshSchedule);
    expect(patchChatMetadata).toHaveBeenCalledWith("chat-1", {
      conversationSchedulesEnabled: true,
      characterSchedules: { "char-1": freshSchedule },
      scheduleWeekStart: getMonday().toISOString(),
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import {
  groundRoleplayHabitScan,
  readRoleplayHabitScan,
  roleplayHabitScanDue,
  roleplayHabitScanGuidance,
  runRoleplayHabitScan,
  scheduleRoleplayHabitScan,
  type RoleplayHabitScan,
  type ScheduleRoleplayHabitScanInput,
} from "./roleplay-habit-scan";

const replies = [
  'Kaul taps her pen on the clipboard. "Twenty minutes." The fan rattles.',
  "Pell laughs, thin. Kaul taps her pen on the clipboard again. The fan rattles.",
  'Mags locks the door. "Nineteen." Kaul taps her pen on the clipboard.',
  "The generator coughs. Kaul taps her pen on the clipboard. The fan rattles.",
];

function chatMessages(contents: string[]) {
  return contents.flatMap((content, index) => [
    { id: `u${index}`, role: "user", content: `I keep going (${index}).` },
    { id: `a${index}`, role: "assistant", content },
  ]);
}

function llmReturning(raw: string): LlmGateway {
  return { complete: vi.fn(async () => raw) } as unknown as LlmGateway;
}

describe("roleplay habit scan", () => {
  it("keeps only habits whose quotes are in the replies and that span three replies", () => {
    const habits = groundRoleplayHabitScan(
      [
        { habit: "Kaul's pen on the clipboard", replies: [1, 2, 3, 4], quotes: ["Kaul taps her pen on the clipboard"] },
        { habit: "Invented quote", replies: [1, 2, 3], quotes: ["She smooths her skirt"] },
        { habit: "Only twice", replies: [1, 2], quotes: ["The fan rattles."] },
        { habit: "Out of range replies", replies: [1, 9, 12], quotes: ["The fan rattles."] },
      ],
      replies,
    );

    expect(habits).toEqual([
      { habit: "Kaul's pen on the clipboard", replies: 4, quotes: ["Kaul taps her pen on the clipboard"] },
    ]);
  });

  it("reads the latest replies, grounds the answer, and records where it stopped", async () => {
    const llm = llmReturning(
      JSON.stringify({
        habits: [{ habit: "Fan noise as a pause", replies: [1, 2, 4], quotes: ["The fan rattles.", "made up"] }],
      }),
    );
    const scan = await runRoleplayHabitScan(
      { llm },
      { messages: chatMessages(replies), now: () => new Date("2026-10-19T12:00:00.000Z") },
    );

    expect(scan).toEqual({
      version: 1,
      throughMessageId: "a3",
      scannedReplies: 4,
      habits: [{ habit: "Fan noise as a pause", replies: 3, quotes: ["The fan rattles."] }],
      scannedAt: "2026-10-19T12:00:00.000Z",
    });
    const request = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(request.messages.at(-1)?.content).toContain("Reply 4:\nThe generator coughs.");
  });

  it("waits for four replies, then rescans after three new ones or when its last reply is gone", () => {
    const scan = { throughMessageId: "a3" } as RoleplayHabitScan;

    expect(roleplayHabitScanDue(chatMessages(replies.slice(0, 3)), null)).toBe(false);
    expect(roleplayHabitScanDue(chatMessages(replies), null)).toBe(true);
    expect(roleplayHabitScanDue(chatMessages([...replies, "Six.", "Seven."]), scan)).toBe(false);
    expect(roleplayHabitScanDue(chatMessages([...replies, "Six.", "Seven.", "Eight."]), scan)).toBe(true);
    expect(
      roleplayHabitScanDue(chatMessages([...replies, "Six."]), { throughMessageId: "deleted" } as RoleplayHabitScan),
    ).toBe(true);
  });

  it("runs a due scan once per chat in the background and stores it on the chat", async () => {
    vi.useFakeTimers();
    try {
      const messages = chatMessages(replies);
      const storage = {
        get: vi.fn(async () => ({ id: "chat-1", metadata: {} })),
        listChatMessages: vi.fn(async () => [...messages].reverse()),
        patchChatMetadata: vi.fn(async () => ({})),
      };
      const llm = llmReturning(
        JSON.stringify({
          habits: [{ habit: "Fan noise as a pause", replies: [1, 2, 4], quotes: ["The fan rattles."] }],
        }),
      );

      scheduleRoleplayHabitScan({
        storage: storage as unknown as ScheduleRoleplayHabitScanInput["storage"],
        llm,
        chatId: "chat-1",
      });
      scheduleRoleplayHabitScan({
        storage: storage as unknown as ScheduleRoleplayHabitScanInput["storage"],
        llm,
        chatId: "chat-1",
      });
      await vi.runAllTimersAsync();

      expect(llm.complete).toHaveBeenCalledTimes(1);
      expect(storage.patchChatMetadata).toHaveBeenCalledWith("chat-1", {
        roleplayHabitScan: expect.objectContaining({
          throughMessageId: "a3",
          habits: [{ habit: "Fan noise as a pause", replies: 3, quotes: ["The fan rattles."] }],
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a stored scan into one steering line per habit", () => {
    const scan = readRoleplayHabitScan({
      roleplayHabitScan: {
        version: 1,
        throughMessageId: "a3",
        scannedReplies: 4,
        habits: [{ habit: "Kaul's pen on the clipboard", replies: 4, quotes: ["Kaul taps her pen on the clipboard"] }],
        scannedAt: "2026-10-19T12:00:00.000Z",
      },
    });

    expect(roleplayHabitScanGuidance(scan)).toEqual([
      "- Kaul's pen on the clipboard (in 4 of the last 4 replies, e.g. \"Kaul taps her pen on the clipboard\"). Leave it out of this reply, and don't swap in a new recurring move.",
    ]);
    expect(readRoleplayHabitScan({ roleplayHabitScan: { version: 99, habits: [] } })).toBeNull();
  });
});

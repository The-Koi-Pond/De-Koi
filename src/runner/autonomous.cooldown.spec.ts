// The runner's texting-first loop against the real autonomous service (only storage is faked). A character who
// texted first must wait out the follow-up cooldown; before the fix the runner re-sent on every 30-second poll.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Message = { role: string; createdAt: string; characterId?: string; extra?: Record<string, unknown> };

const store = vi.hoisted(() => ({ messages: [] as Message[] }));
const CHAT_ID = "chat-runaway";
const CHARACTER_ID = "char-harlequin";

vi.mock("../shared/api/storage-api", () => {
  const chat = {
    id: "chat-runaway",
    name: "Harlequin",
    mode: "conversation",
    characterIds: ["char-harlequin"],
    metadata: { autonomousMessages: true },
  };
  // Talkativeness 100 while idle: first text after 10 quiet minutes, follow-ups after 20 and 40.
  const character = { id: "char-harlequin", data: { name: "Harlequin", extensions: { talkativeness: 100 } } };
  return {
    storageApi: {
      list: async (entity: string) => (entity === "chats" ? [chat] : []),
      get: async (entity: string, id: string) =>
        entity === "chats" && id === chat.id ? chat : entity === "characters" && id === character.id ? character : null,
      listChatMessages: async () => store.messages,
    },
  };
});
vi.mock("../shared/api/chat-command-api", () => ({ chatCommandApi: { markAutonomousUnread: async () => ({}) } }));

import { clearChatActivity } from "../engine/modes/chat/autonomous/activity-state";
import { startAutonomousScheduler } from "./autonomous";
import type { RunnerJob } from "./jobs";

const MINUTE = 60_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const userMessage = (msAgo: number): Message => ({ role: "user", createdAt: iso(msAgo) });
const reply = (msAgo: number): Message => ({
  role: "assistant",
  createdAt: iso(msAgo),
  characterId: CHARACTER_ID,
  extra: { answersUserVersion: { messageId: "m-user", index: 0 } },
});
const textedFirst = (msAgo: number): Message => ({
  role: "assistant",
  createdAt: iso(msAgo),
  characterId: CHARACTER_ID,
  extra: {},
});

function startRunner(onJob: () => void = () => undefined) {
  const startJob = vi.fn((_input: Record<string, unknown>) => {
    onJob();
    return { id: `job-${startJob.mock.calls.length}` } as RunnerJob;
  });
  const stop = startAutonomousScheduler({
    startJob,
    runningForChat: () => null,
    waitForJob: async () => true,
    presence: () => "idle",
    onTexted: async () => undefined,
  });
  return { startJob, stop };
}

describe("runner: texting first keeps its cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T17:00:00Z"));
    clearChatActivity(CHAT_ID);
    store.messages = [userMessage(30 * MINUTE), reply(30 * MINUTE - 10_000)];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("texts once, then waits out the cooldown instead of texting on every poll", async () => {
    // The saved text isn't visible in storage yet, so only the runner's own record of the send holds it back.
    const { startJob, stop } = startRunner();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    stop();
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it("sends the next follow-up only after the doubled cooldown", async () => {
    const { startJob, stop } = startRunner(() => store.messages.push(textedFirst(0)));
    await vi.advanceTimersByTimeAsync(19 * MINUTE);
    expect(startJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    stop();
    expect(startJob).toHaveBeenCalledTimes(2);
  });

  it("counts texts already in the chat after a restart", async () => {
    store.messages.push(textedFirst(1 * MINUTE));
    const { startJob, stop } = startRunner();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    stop();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("stops at the follow-up cap even when the chat is all that remembers it", async () => {
    store.messages.push(textedFirst(25 * MINUTE), textedFirst(15 * MINUTE), textedFirst(1 * MINUTE));
    const { startJob, stop } = startRunner();
    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE);
    stop();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("starts counting again once the user writes", async () => {
    store.messages.push(textedFirst(20 * MINUTE), userMessage(15 * MINUTE), reply(15 * MINUTE - 10_000));
    const { startJob, stop } = startRunner();
    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    stop();
    expect(startJob).toHaveBeenCalledTimes(1);
  });
});

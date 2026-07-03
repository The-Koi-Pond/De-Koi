import { describe, expect, it } from "vitest";

import {
  clearConversationRevealGeneration,
  collectFreshAssistantPartRevealStarts,
  findFreshAssistantNotificationMessage,
  isCurrentConversationRevealGeneration,
  resolveConversationVisiblePartCount,
  startConversationRevealGeneration,
  type ConversationRevealGenerationMap,
} from "./conversation-part-reveal";

describe("conversation part reveal", () => {
  it("does not notify for fresh assistant messages that were already in the loaded transcript", () => {
    const previousMessageKeys = new Set(["user-1", "assistant-1", "user-2"]);

    const notification = findFreshAssistantNotificationMessage({
      initialLoadSettled: true,
      candidates: [
        {
          key: "assistant-1",
          role: "assistant",
          createdAtMs: 100_000,
          message: { id: "assistant-1", role: "assistant", content: "Already here", createdAt: "1970-01-01T00:01:40.000Z" },
        },
      ],
      previousMessageKeys,
      now: 101_000,
    });

    expect(notification).toBeNull();
  });

  it("notifies for fresh assistant messages appended after the previously loaded transcript", () => {
    const appendedAssistant = {
      id: "assistant-2",
      role: "assistant" as const,
      content: "New response",
      createdAt: "1970-01-01T00:01:40.000Z",
    };

    const notification = findFreshAssistantNotificationMessage({
      initialLoadSettled: true,
      candidates: [
        { key: "user-1", role: "user", createdAtMs: 99_000 },
        { key: "assistant-1", role: "assistant", createdAtMs: 99_500 },
        { key: "user-2", role: "user", createdAtMs: 100_000 },
        { key: appendedAssistant.id, role: appendedAssistant.role, createdAtMs: 101_000, message: appendedAssistant },
      ],
      previousMessageKeys: new Set(["user-1", "assistant-1"]),
      now: 102_000,
    });

    expect(notification).toBe(appendedAssistant);
  });

  it("starts fresh unseen multi-part assistant messages at the first part before the reveal effect runs", () => {
    const starts = collectFreshAssistantPartRevealStarts({
      initialLoadSettled: true,
      candidates: [
        {
          key: "assistant-1",
          role: "assistant",
          createdAtMs: 100_000,
          partCount: 3,
        },
      ],
      prevKeys: new Set(["user-1"]),
      seenKeys: new Set(["user-1"]),
      now: 101_000,
    });

    expect(starts).toEqual([{ key: "assistant-1", count: 3, initialVisiblePartCount: 1 }]);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-1",
        partCount: 3,
        freshRevealStarts: starts,
      }),
    ).toBe(1);
  });

  it("renders settled history and already-seen messages fully", () => {
    const initialLoadStarts = collectFreshAssistantPartRevealStarts({
      initialLoadSettled: false,
      candidates: [
        {
          key: "assistant-history",
          role: "assistant",
          createdAtMs: 100_000,
          partCount: 3,
        },
      ],
      prevKeys: new Set(),
      seenKeys: new Set(),
      now: 101_000,
    });
    const seenStarts = collectFreshAssistantPartRevealStarts({
      initialLoadSettled: true,
      candidates: [
        {
          key: "assistant-seen",
          role: "assistant",
          createdAtMs: 100_000,
          partCount: 3,
        },
      ],
      prevKeys: new Set(),
      seenKeys: new Set(["assistant-seen"]),
      now: 101_000,
    });

    expect(initialLoadStarts).toEqual([]);
    expect(seenStarts).toEqual([]);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-history",
        partCount: 3,
        freshRevealStarts: initialLoadStarts,
      }),
    ).toBe(3);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-seen",
        partCount: 3,
        freshRevealStarts: seenStarts,
      }),
    ).toBe(3);
  });

  it("starts fresh same-key assistant messages when saved content becomes multi-part", () => {
    const starts = collectFreshAssistantPartRevealStarts({
      initialLoadSettled: true,
      candidates: [
        {
          key: "assistant-saving",
          role: "assistant",
          createdAtMs: 100_000,
          partCount: 3,
        },
      ],
      prevKeys: new Set(["assistant-saving"]),
      prevPartCounts: new Map([["assistant-saving", 1]]),
      seenKeys: new Set(["assistant-saving"]),
      now: 101_000,
    });

    expect(starts).toEqual([{ key: "assistant-saving", count: 3, initialVisiblePartCount: 1 }]);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-saving",
        partCount: 3,
        freshRevealStarts: starts,
      }),
    ).toBe(1);
  });

  it("starts fresh same-key assistant messages when saved content adds another part", () => {
    const starts = collectFreshAssistantPartRevealStarts({
      initialLoadSettled: true,
      candidates: [
        {
          key: "assistant-saving",
          role: "assistant",
          createdAtMs: 100_000,
          partCount: 3,
        },
      ],
      prevKeys: new Set(["assistant-saving"]),
      prevPartCounts: new Map([["assistant-saving", 2]]),
      seenKeys: new Set(["assistant-saving"]),
      now: 101_000,
    });

    expect(starts).toEqual([{ key: "assistant-saving", count: 3, initialVisiblePartCount: 2 }]);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-saving",
        partCount: 3,
        currentVisiblePartCount: 1,
        freshRevealStarts: starts,
      }),
    ).toBe(2);
  });

  it("makes stale same-key reveal generations inert after replacement", () => {
    const generations: ConversationRevealGenerationMap = {};

    const firstGeneration = startConversationRevealGeneration(generations, "assistant-1");
    const replacementGeneration = startConversationRevealGeneration(generations, "assistant-1");

    expect(isCurrentConversationRevealGeneration(generations, "assistant-1", firstGeneration)).toBe(false);
    expect(isCurrentConversationRevealGeneration(generations, "assistant-1", replacementGeneration)).toBe(true);

    clearConversationRevealGeneration(generations, "assistant-1", firstGeneration);
    expect(isCurrentConversationRevealGeneration(generations, "assistant-1", replacementGeneration)).toBe(true);

    clearConversationRevealGeneration(generations, "assistant-1", replacementGeneration);
    expect(isCurrentConversationRevealGeneration(generations, "assistant-1", replacementGeneration)).toBe(false);
  });
});

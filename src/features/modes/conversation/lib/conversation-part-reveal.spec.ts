import { describe, expect, it } from "vitest";

import {
  clearConversationRevealGeneration,
  collectFreshAssistantPartRevealStarts,
  isCurrentConversationRevealGeneration,
  resolveConversationVisiblePartCount,
  startConversationRevealGeneration,
  type ConversationRevealGenerationMap,
} from "./conversation-part-reveal";

describe("conversation part reveal", () => {
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

    expect(starts).toEqual([{ key: "assistant-1", count: 3 }]);
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

    expect(starts).toEqual([{ key: "assistant-saving", count: 3 }]);
    expect(
      resolveConversationVisiblePartCount({
        key: "assistant-saving",
        partCount: 3,
        freshRevealStarts: starts,
      }),
    ).toBe(1);
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

import { describe, expect, it, vi } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type { CanonicalMemoryInput, CanonicalMemoryPatch, CanonicalMemoryRecord } from "../contracts/types/memory";
import { extractCanonicalMemoryConsequences, persistCanonicalMemoryConsequences } from "./automatic-memory-capture";

function llmReturning(raw: string): LlmGateway {
  return {
    complete: vi.fn(async () => raw),
    async *stream() {
      yield { type: "done" };
    },
    listModels: vi.fn(async () => []),
  };
}

function canonicalMemoryStorage(seed: CanonicalMemoryRecord[] = []) {
  const memories = new Map(seed.map((memory) => [memory.id, memory]));
  const storage = {
    get: vi.fn(async (_entity: string, id: string) => memories.get(id) ?? null),
    createMemory: vi.fn(async (input: CanonicalMemoryInput) => {
      const record = {
        ...input,
        id: String(input.id),
        status: input.status ?? "active",
        title: input.title ?? null,
        tags: input.tags ?? [],
        supersedesMemoryId: input.supersedesMemoryId ?? null,
        supersededByMemoryId: input.supersededByMemoryId ?? null,
        payload: input.payload ?? {},
        createdAt: input.createdAt ?? "2026-07-19T10:00:00.000Z",
        updatedAt: input.updatedAt ?? "2026-07-19T10:00:00.000Z",
      } satisfies CanonicalMemoryRecord;
      memories.set(record.id, record);
      return record;
    }),
    updateMemory: vi.fn(async (id: string, patch: CanonicalMemoryPatch) => {
      const record = { ...memories.get(id)!, ...patch, id, updatedAt: "2026-07-19T10:01:00.000Z" };
      memories.set(id, record);
      return record;
    }),
  } as unknown as StorageGateway;
  return { memories, storage };
}

describe("automatic canonical-memory consequence extraction", () => {
  it("extracts a direct user fact from the complete saved exchange with exact evidence provenance", async () => {
    const llm = llmReturning(
      JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "The user's cat is named Miso.",
            confidence: 0.96,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
        ],
      }),
    );

    const result = await extractCanonicalMemoryConsequences({
      llm,
      request: {
        version: 1,
        jobId: "job-1",
        chatId: "chat-1",
        mode: "conversation",
        scope: { kind: "character", id: "char-1" },
        activeCharacterId: "char-1",
        sourceMessages: [
          {
            id: "user-1",
            chatId: "chat-1",
            role: "user",
            content: "My cat is named Miso.",
            characterId: null,
            createdAt: "2026-07-19T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            chatId: "chat-1",
            role: "assistant",
            content: "I'll remember that.",
            characterId: "char-1",
            createdAt: "2026-07-19T10:00:01.000Z",
          },
        ],
        eligibleMemories: [],
      },
    });

    expect(result).toEqual({
      candidates: [
        expect.objectContaining({
          kind: "fact",
          status: "active",
          scope: { kind: "character", id: "char-1" },
          content: "The user's cat is named Miso.",
          confidence: 0.96,
          provenance: expect.objectContaining({
            sourceChatId: "chat-1",
            messageIds: ["user-1"],
            characterId: "char-1",
          }),
          payload: expect.objectContaining({
            automatic: true,
            captureJobId: "job-1",
            evidence: "direct_user_assertion",
          }),
        }),
      ],
      skippedCount: 0,
    });
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("user-1 | user | My cat is named Miso."),
          }),
          expect.objectContaining({
            content: expect.stringContaining("assistant-1 | assistant | I'll remember that."),
          }),
        ]),
      }),
      undefined,
    );
  });

  it("reprocessing the same semantic consequence updates one stable canonical record", async () => {
    const { memories, storage } = canonicalMemoryStorage();
    const candidate = {
      kind: "fact",
      status: "active",
      scope: { kind: "character", id: "char-1" },
      content: "The user's cat is named Miso.",
      confidence: 0.96,
      provenance: { sourceChatId: "chat-1", messageIds: ["user-1"], characterId: "char-1" },
      tags: ["automatic", "consequence"],
      payload: { automatic: true, captureJobId: "job-1" },
    } satisfies CanonicalMemoryInput;

    const first = await persistCanonicalMemoryConsequences({
      storage,
      candidates: [candidate, candidate],
      eligibleMemories: [],
      now: "2026-07-19T10:00:00.000Z",
    });
    const second = await persistCanonicalMemoryConsequences({
      storage,
      candidates: [
        {
          ...candidate,
          provenance: { ...candidate.provenance, sourceChatId: "chat-2", messageIds: ["user-2"] },
          payload: { ...candidate.payload, captureJobId: "job-2" },
        },
      ],
      eligibleMemories: [...memories.values()],
      now: "2026-07-19T10:01:00.000Z",
    });
    await persistCanonicalMemoryConsequences({
      storage,
      candidates: [{ ...candidate, supersedesMemoryId: "not-an-eligible-memory" }],
      eligibleMemories: [...memories.values()],
      now: "2026-07-19T10:02:00.000Z",
    });

    expect(memories.size).toBe(1);
    expect(first.affected).toEqual([expect.objectContaining({ operation: "created" })]);
    expect(second.affected).toEqual([expect.objectContaining({ operation: "updated" })]);
    expect(second.affected[0]?.memory.provenance.messageIds).toEqual(["user-1", "user-2"]);
    expect([...memories.values()][0]?.supersedesMemoryId).toBeNull();
  });

  it("supersedes only an eligible active memory and preserves both sides of the history link", async () => {
    const oldMemory = {
      id: "old-cat-name",
      kind: "fact",
      status: "active",
      scope: { kind: "character", id: "char-1" },
      content: "The user's cat is named Mochi.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-old", messageIds: ["old-user"] },
      title: null,
      tags: [],
      supersedesMemoryId: null,
      supersededByMemoryId: null,
      payload: {},
      createdAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-18T10:00:00.000Z",
    } satisfies CanonicalMemoryRecord;
    const { memories, storage } = canonicalMemoryStorage([oldMemory]);

    const result = await persistCanonicalMemoryConsequences({
      storage,
      candidates: [
        {
          kind: "contradiction",
          status: "active",
          scope: { kind: "character", id: "char-1" },
          content: "The user's cat is named Miso, not Mochi.",
          confidence: 0.98,
          provenance: { sourceChatId: "chat-1", messageIds: ["user-1"], characterId: "char-1" },
          supersedesMemoryId: "old-cat-name",
          payload: { automatic: true, captureJobId: "job-2" },
        },
      ],
      eligibleMemories: [oldMemory],
      now: "2026-07-19T10:00:00.000Z",
    });

    const created = result.affected[0]?.memory;
    expect(created?.supersedesMemoryId).toBe("old-cat-name");
    expect(result.affected).toEqual([
      expect.objectContaining({ operation: "created", memory: expect.objectContaining({ id: created?.id }) }),
      expect.objectContaining({ operation: "superseded", memory: expect.objectContaining({ id: "old-cat-name" }) }),
    ]);
    expect(memories.get("old-cat-name")).toEqual(
      expect.objectContaining({ status: "superseded", supersededByMemoryId: created?.id }),
    );
  });

  it.each(["pinned", "stale", "deleted"] as const)(
    "does not rewrite a supplied %s memory through the persistence boundary",
    async (status) => {
      const protectedMemory = {
        id: `protected-${status}`,
        kind: "fact",
        status,
        scope: { kind: "character", id: "char-1" },
        content: "The user's cat is named Mochi.",
        confidence: 0.9,
        provenance: { sourceChatId: "chat-old", messageIds: ["old-user"] },
        title: null,
        tags: status === "pinned" ? ["manual"] : [],
        supersedesMemoryId: null,
        supersededByMemoryId: null,
        payload: status === "pinned" ? { source: "manual" } : {},
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T10:00:00.000Z",
      } satisfies CanonicalMemoryRecord;
      const { memories, storage } = canonicalMemoryStorage([protectedMemory]);

      const result = await persistCanonicalMemoryConsequences({
        storage,
        candidates: [
          {
            kind: "contradiction",
            status: "active",
            scope: { kind: "character", id: "char-1" },
            content: "The user's cat is named Miso, not Mochi.",
            confidence: 0.98,
            provenance: { sourceChatId: "chat-1", messageIds: ["user-1"], characterId: "char-1" },
            supersedesMemoryId: protectedMemory.id,
            payload: { automatic: true, captureJobId: "job-protected" },
          },
        ],
        eligibleMemories: [protectedMemory],
        now: "2026-07-19T10:00:00.000Z",
      });

      expect(result.affected).toEqual([
        expect.objectContaining({
          operation: "created",
          memory: expect.objectContaining({ supersedesMemoryId: null }),
        }),
      ]);
      expect(memories.get(protectedMemory.id)).toEqual(protectedMemory);
    },
  );

  it("rejects an assistant-authored guess presented as a fact about the user", async () => {
    const llm = llmReturning(
      JSON.stringify({
        memories: [
          {
            kind: "fact",
            content: "The user secretly dislikes crowds.",
            confidence: 0.91,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-1"],
          },
          {
            kind: "fact",
            content: "The user's cat is named Miso.",
            confidence: 0.99,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
          {
            kind: "fact",
            content: "The user dislikes crowds.",
            confidence: 0.99,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1", "assistant-1"],
          },
        ],
      }),
    );

    const result = await extractCanonicalMemoryConsequences({
      llm,
      request: {
        version: 1,
        jobId: "job-1",
        chatId: "chat-1",
        mode: "conversation",
        scope: { kind: "character", id: "char-1" },
        activeCharacterId: "char-1",
        sourceMessages: [
          {
            id: "user-1",
            chatId: "chat-1",
            role: "user",
            content: "The station is busy tonight.",
            characterId: null,
            createdAt: "2026-07-19T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            chatId: "chat-1",
            role: "assistant",
            content: "You probably dislike crowds.",
            characterId: "char-1",
            createdAt: "2026-07-19T10:00:01.000Z",
          },
        ],
        eligibleMemories: [],
      },
    });

    expect(result).toEqual({ candidates: [], skippedCount: 3 });
  });

  it("accepts supported promises, relationship changes, scene events, plot state, and eligible contradictions", async () => {
    const llm = llmReturning(
      JSON.stringify({
        memories: [
          {
            kind: "preference",
            content: "The user prefers quiet rooms.",
            confidence: 0.9,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
          },
          {
            kind: "promise",
            content: "Mira promised to keep the door closed.",
            confidence: 0.88,
            evidence: "explicit_promise",
            sourceMessageIds: ["assistant-1"],
          },
          {
            kind: "relationship_state",
            content: "The user and Mira now trust one another with the key.",
            confidence: 0.81,
            evidence: "explicit_exchange",
            sourceMessageIds: ["user-1", "assistant-1"],
          },
          {
            kind: "scene_event",
            content: "Mira locked the archive door.",
            confidence: 0.93,
            evidence: "explicit_screen_event",
            sourceMessageIds: ["assistant-1"],
          },
          {
            kind: "plot_state",
            content: "The archive door is locked.",
            confidence: 0.93,
            evidence: "explicit_screen_event",
            sourceMessageIds: ["assistant-1"],
          },
          {
            kind: "contradiction",
            content: "The user's cat is named Miso, not Mochi.",
            confidence: 0.98,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
            supersedesMemoryId: "old-cat-name",
          },
        ],
      }),
    );
    const eligibleMemory = {
      id: "old-cat-name",
      kind: "fact",
      status: "active",
      scope: { kind: "character", id: "char-1" },
      content: "The user's cat is named Mochi.",
      confidence: 0.9,
      provenance: { sourceChatId: "chat-old", messageIds: ["old-user"] },
      title: null,
      tags: [],
      supersedesMemoryId: null,
      supersededByMemoryId: null,
      payload: {},
      createdAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-18T10:00:00.000Z",
    } satisfies CanonicalMemoryRecord;

    const result = await extractCanonicalMemoryConsequences({
      llm,
      request: {
        version: 1,
        jobId: "job-2",
        chatId: "chat-1",
        mode: "roleplay",
        scope: { kind: "character", id: "char-1" },
        activeCharacterId: "char-1",
        sourceMessages: [
          {
            id: "user-1",
            chatId: "chat-1",
            role: "user",
            content: "Miso is my cat, not Mochi. Please keep this room quiet.",
            characterId: null,
            createdAt: "2026-07-19T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            chatId: "chat-1",
            role: "assistant",
            content: "I trust you with the key. I promise I'll keep the archive door closed. Mira locks it.",
            characterId: "char-1",
            createdAt: "2026-07-19T10:00:01.000Z",
          },
        ],
        eligibleMemories: [eligibleMemory],
      },
    });

    expect(result.skippedCount).toBe(0);
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      "preference",
      "promise",
      "relationship_state",
      "scene_event",
      "plot_state",
      "contradiction",
    ]);
    expect(result.candidates.at(-1)?.supersedesMemoryId).toBe("old-cat-name");
    expect(result.candidates[2]?.provenance.messageIds).toEqual(["user-1", "assistant-1"]);
  });

  it("rejects relationship state supported by only one overlapping evidence token", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: llmReturning(
        JSON.stringify({
          memories: [
            {
              kind: "relationship_state",
              content: "The user and Mira are allies forever.",
              confidence: 0.92,
              evidence: "explicit_exchange",
              sourceMessageIds: ["assistant-1"],
            },
          ],
        }),
      ),
      request: {
        version: 1,
        jobId: "job-weak-relationship",
        chatId: "chat-1",
        mode: "roleplay",
        scope: { kind: "character", id: "char-1" },
        activeCharacterId: "char-1",
        sourceMessages: [
          {
            id: "assistant-1",
            chatId: "chat-1",
            role: "assistant",
            content: "We are allies now.",
            characterId: "char-1",
            createdAt: "2026-07-19T10:00:01.000Z",
          },
        ],
        eligibleMemories: [],
      },
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("keeps low-confidence supported evidence stale and rejects unsupported inference or invented supersession IDs", async () => {
    const llm = llmReturning(
      JSON.stringify({
        memories: [
          {
            kind: "relationship_state",
            content: "Mira may distrust the user.",
            confidence: 0.52,
            evidence: "explicit_exchange",
            sourceMessageIds: ["user-1", "assistant-1"],
          },
          {
            kind: "relationship_state",
            content: "Mira secretly despises the user.",
            confidence: 0.99,
            evidence: "inference",
            sourceMessageIds: ["assistant-1"],
          },
          {
            kind: "contradiction",
            content: "An unsupported correction.",
            confidence: 0.99,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-1"],
            supersedesMemoryId: "invented-id",
          },
        ],
      }),
    );

    const result = await extractCanonicalMemoryConsequences({
      llm,
      request: {
        version: 1,
        jobId: "job-3",
        chatId: "chat-1",
        mode: "conversation",
        scope: { kind: "character", id: "char-1" },
        activeCharacterId: "char-1",
        sourceMessages: [
          {
            id: "user-1",
            chatId: "chat-1",
            role: "user",
            content: "Mira, I am not sure whether I trust you yet.",
            characterId: null,
            createdAt: "2026-07-19T10:00:00.000Z",
          },
          {
            id: "assistant-1",
            chatId: "chat-1",
            role: "assistant",
            content: "I understand.",
            characterId: "char-1",
            createdAt: "2026-07-19T10:00:01.000Z",
          },
        ],
        eligibleMemories: [],
      },
    });

    expect(result.candidates).toEqual([expect.objectContaining({ status: "stale", confidence: 0.52 })]);
    expect(result.skippedCount).toBe(2);
  });
});

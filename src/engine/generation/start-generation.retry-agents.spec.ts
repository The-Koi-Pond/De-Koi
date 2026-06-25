import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import {
  loadMessagesForGenerationTarget,
  patchMessageExtrasForGeneration,
  spriteExpressionPatchesForTarget,
} from "./start-generation";

const expressionResult = (expressions: Array<{ characterId: string; expression: string }>): AgentResult =>
  ({
    agentId: "expression",
    agentType: "expression",
    type: "sprite_change",
    success: true,
    error: null,
    data: { expressions },
    tokensUsed: 0,
    durationMs: 0,
  }) as AgentResult;

function messageExtraPatchStorage(
  rows: Record<string, Record<string, unknown>>,
  options: {
    failPatchCall?: number | number[];
    beforePatchChatMessageExtra?: (
      messageId: string,
      state: Map<
        string,
        {
          id: string;
          extra: Record<string, unknown>;
        }
      >,
      call: number,
    ) => void;
  } = {},
) {
  const failPatchCalls = new Set(
    Array.isArray(options.failPatchCall)
      ? options.failPatchCall
      : options.failPatchCall === undefined
        ? []
        : [options.failPatchCall],
  );
  let patchCalls = 0;
  const state = new Map(
    Object.entries(rows).map(([id, extra]) => [
      id,
      {
        id,
        extra: { ...extra },
      },
    ]),
  );
  return {
    state,
    storage: {
      async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
        const row = state.get(messageId);
        return row ? ({ id: row.id, extra: { ...row.extra } } as T) : null;
      },
      async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
        patchCalls += 1;
        options.beforePatchChatMessageExtra?.(messageId, state, patchCalls);
        if (failPatchCalls.has(patchCalls)) throw new Error("patch failed");
        const row = state.get(messageId);
        if (!row) throw new Error(`missing ${messageId}`);
        const extra = { ...row.extra, ...patch };
        const updated = { id: row.id, extra };
        state.set(messageId, updated);
        return { id: updated.id, extra: { ...updated.extra } } as T;
      },
    },
  };
}

describe("spriteExpressionPatchesForTarget", () => {
  it("routes persona expression retries to the preceding user message", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "I try not to blush.",
      extra: { personaSnapshot: { personaId: "persona-1" } },
    };
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant",
      characterId: "char-1",
      content: "Mira smiles while the player blushes.",
    };

    const patches = spriteExpressionPatchesForTarget({
      chat: { id: "chat-1", personaId: "persona-1" },
      messages: [userMessage, assistantMessage],
      target: assistantMessage,
      results: [
        expressionResult([
          { characterId: "char-1", expression: "happy" },
          { characterId: "persona-1", expression: "shy" },
        ]),
      ],
      availableSprites: [
        { characterId: "char-1", characterName: "Mira", expressions: ["happy", "neutral"] },
        { characterId: "persona-1", characterName: "Player", expressions: ["shy", "neutral"] },
      ],
    });

    expect(patches).toEqual([
      { messageId: "assistant-1", spriteExpressions: { "char-1": "happy" } },
      { messageId: "user-1", spriteExpressions: { "persona-1": "shy" } },
    ]);
  });

  it("keeps persona expressions on user-message retry targets", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "I grin.",
      extra: {
        personaSnapshot: { personaId: "persona-1" },
        spriteExpressions: { "persona-1": "neutral" },
      },
    };

    const patches = spriteExpressionPatchesForTarget({
      chat: { id: "chat-1", personaId: "persona-1" },
      messages: [userMessage],
      target: userMessage,
      results: [expressionResult([{ characterId: "persona-1", expression: "happy" }])],
      availableSprites: [{ characterId: "persona-1", characterName: "Player", expressions: ["happy", "neutral"] }],
    });

    expect(patches).toEqual([{ messageId: "user-1", spriteExpressions: { "persona-1": "happy" } }]);
  });

  it("routes persona expressions from a newly saved assistant target to the latest user message", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "I look away.",
      extra: { personaSnapshot: { personaId: "persona-1" } },
    };
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant",
      characterId: "char-1",
      content: "Mira laughs while the player looks away.",
    };

    const patches = spriteExpressionPatchesForTarget({
      chat: { id: "chat-1", personaId: "persona-1" },
      messages: [userMessage],
      target: assistantMessage,
      results: [
        expressionResult([
          { characterId: "char-1", expression: "happy" },
          { characterId: "persona-1", expression: "shy" },
        ]),
      ],
      availableSprites: [
        { characterId: "char-1", characterName: "Mira", expressions: ["happy", "neutral"] },
        { characterId: "persona-1", characterName: "Player", expressions: ["shy", "neutral"] },
      ],
    });

    expect(patches).toEqual([
      { messageId: "assistant-1", spriteExpressions: { "char-1": "happy" } },
      { messageId: "user-1", spriteExpressions: { "persona-1": "shy" } },
    ]);
  });

  it("fills omitted assistant and persona targets from their own message text", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "I try not to blush.",
      extra: { personaSnapshot: { personaId: "persona-1" } },
    };
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant",
      characterId: "char-1",
      content: "Mira smiles at the player.",
    };

    const patches = spriteExpressionPatchesForTarget({
      chat: {
        id: "chat-1",
        personaId: "persona-1",
        metadata: { expressionAvatarsEnabled: true },
      },
      messages: [userMessage],
      target: assistantMessage,
      results: [expressionResult([])],
      availableSprites: [
        { characterId: "char-1", characterName: "Mira", expressions: ["neutral", "happy"] },
        { characterId: "persona-1", characterName: "Player", expressions: ["neutral", "shy"] },
      ],
    });

    expect(patches).toEqual([
      { messageId: "assistant-1", spriteExpressions: { "char-1": "happy" } },
      { messageId: "user-1", spriteExpressions: { "persona-1": "shy" } },
    ]);
  });

  it("fills persona fallback from first-person text instead of another actor's emotion", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "Mira smiles while I panic.",
      extra: { personaSnapshot: { personaId: "persona-1" } },
    };
    const assistantMessage = {
      id: "assistant-1",
      role: "assistant",
      characterId: "char-1",
      content: "Mira smiles at the player.",
    };

    const patches = spriteExpressionPatchesForTarget({
      chat: {
        id: "chat-1",
        personaId: "persona-1",
        metadata: { expressionAvatarsEnabled: true },
      },
      messages: [userMessage],
      target: assistantMessage,
      results: [expressionResult([])],
      availableSprites: [
        { characterId: "char-1", characterName: "Mira", expressions: ["neutral", "happy", "scared"] },
        { characterId: "persona-1", characterName: "Player", expressions: ["neutral", "happy", "scared"] },
      ],
    });

    expect(patches).toEqual([
      { messageId: "assistant-1", spriteExpressions: { "char-1": "happy" } },
      { messageId: "user-1", spriteExpressions: { "persona-1": "scared" } },
    ]);
  });
});

describe("patchMessageExtrasForGeneration", () => {
  it("patches split target and persona message extras together", async () => {
    const { state, storage } = messageExtraPatchStorage({
      "assistant-1": { spriteExpressions: { "char-1": "neutral" } },
      "user-1": { spriteExpressions: { "persona-1": "neutral" } },
    });

    const patched = await patchMessageExtrasForGeneration(storage, [
      { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
      { messageId: "user-1", patch: { spriteExpressions: { "persona-1": "shy" } } },
    ]);

    expect(patched.map((row) => (row as { id: string }).id)).toEqual(["assistant-1", "user-1"]);
    expect(state.get("assistant-1")?.extra).toEqual({ spriteExpressions: { "char-1": "happy" } });
    expect(state.get("user-1")?.extra).toEqual({ spriteExpressions: { "persona-1": "shy" } });
  });

  it("rolls back earlier message extra patches when a later split patch fails", async () => {
    const { state, storage } = messageExtraPatchStorage(
      {
        "assistant-1": { spriteExpressions: { "char-1": "neutral" } },
        "user-1": { spriteExpressions: { "persona-1": "neutral" } },
      },
      { failPatchCall: 2 },
    );

    await expect(
      patchMessageExtrasForGeneration(storage, [
        { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
        { messageId: "user-1", patch: { spriteExpressions: { "persona-1": "shy" } } },
      ]),
    ).rejects.toThrow("patch failed");

    expect(state.get("assistant-1")?.extra).toEqual({ spriteExpressions: { "char-1": "neutral" } });
    expect(state.get("user-1")?.extra).toEqual({ spriteExpressions: { "persona-1": "neutral" } });
  });

  it("surfaces rollback failures after a split message extra patch fails", async () => {
    const { state, storage } = messageExtraPatchStorage(
      {
        "assistant-1": { spriteExpressions: { "char-1": "neutral" } },
        "user-1": { spriteExpressions: { "persona-1": "neutral" } },
      },
      { failPatchCall: [2, 3] },
    );

    await expect(
      patchMessageExtrasForGeneration(storage, [
        { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
        { messageId: "user-1", patch: { spriteExpressions: { "persona-1": "shy" } } },
      ]),
    ).rejects.toThrow("Message extra patch failed and rollback did not fully restore state");

    expect(state.get("assistant-1")?.extra).toEqual({ spriteExpressions: { "char-1": "happy" } });
    expect(state.get("user-1")?.extra).toEqual({ spriteExpressions: { "persona-1": "neutral" } });
  });

  it("preserves unrelated message extra keys added before rollback", async () => {
    const { state, storage } = messageExtraPatchStorage(
      {
        "assistant-1": { spriteExpressions: { "char-1": "neutral" } },
        "user-1": { spriteExpressions: { "persona-1": "neutral" } },
      },
      {
        failPatchCall: 2,
        beforePatchChatMessageExtra: (messageId, rows, call) => {
          if (call !== 3 || messageId !== "assistant-1") return;
          const row = rows.get(messageId);
          if (!row) return;
          rows.set(messageId, { ...row, extra: { ...row.extra, freshDuringRollback: "kept" } });
        },
      },
    );

    await expect(
      patchMessageExtrasForGeneration(storage, [
        { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
        { messageId: "user-1", patch: { spriteExpressions: { "persona-1": "shy" } } },
      ]),
    ).rejects.toThrow("patch failed");

    expect(state.get("assistant-1")?.extra).toEqual({
      spriteExpressions: { "char-1": "neutral" },
      freshDuringRollback: "kept",
    });
    expect(state.get("user-1")?.extra).toEqual({ spriteExpressions: { "persona-1": "neutral" } });
  });

  it("surfaces unrecovered state when rollback would need to delete a newly added extra key", async () => {
    const { state, storage } = messageExtraPatchStorage(
      {
        "assistant-1": { stable: "kept" },
        "user-1": { spriteExpressions: { "persona-1": "neutral" } },
      },
      { failPatchCall: 2 },
    );

    await expect(
      patchMessageExtrasForGeneration(storage, [
        { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
        { messageId: "user-1", patch: { spriteExpressions: { "persona-1": "shy" } } },
      ]),
    ).rejects.toThrow("Message extra patch failed and rollback did not fully restore state");

    expect(state.get("assistant-1")?.extra).toEqual({
      stable: "kept",
      spriteExpressions: { "char-1": "happy" },
    });
    expect(state.get("user-1")?.extra).toEqual({ spriteExpressions: { "persona-1": "neutral" } });
  });

  it("preserves unrelated message extra keys added before the committed patch", async () => {
    const { state, storage } = messageExtraPatchStorage(
      {
        "assistant-1": {
          spriteExpressions: { "char-1": "neutral" },
          stable: "kept",
        },
      },
      {
        beforePatchChatMessageExtra: (messageId, rows) => {
          if (messageId !== "assistant-1") return;
          const row = rows.get(messageId);
          if (!row || row.extra.fresh === "interleaved") return;
          rows.set(messageId, { ...row, extra: { ...row.extra, fresh: "interleaved" } });
        },
      },
    );

    await patchMessageExtrasForGeneration(storage, [
      { messageId: "assistant-1", patch: { spriteExpressions: { "char-1": "happy" } } },
    ]);

    expect(state.get("assistant-1")?.extra).toEqual({
      spriteExpressions: { "char-1": "happy" },
      stable: "kept",
      fresh: "interleaved",
    });
  });
});
describe("loadMessagesForGenerationTarget", () => {
  it("keeps targeted retry fallback message loads bounded when the clicked message is missing", async () => {
    const listCalls: unknown[] = [];
    const messages = await loadMessagesForGenerationTarget({
      chatId: "chat-1",
      chat: { id: "chat-1", metadata: { contextMessageLimit: 12 } },
      input: { chatId: "chat-1" },
      targetMessageId: "deleted-message",
      storage: {
        async getChatMessage() {
          return null;
        },
        async listChatMessages(_chatId: string, options?: unknown) {
          listCalls.push(options);
          return [];
        },
      } as never,
    });

    expect(messages).toEqual([]);
    expect(listCalls).toEqual([
      expect.objectContaining({
        limit: expect.any(Number),
      }),
    ]);
  });
});

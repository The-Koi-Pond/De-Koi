import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import { patchMessageExtrasForGeneration, spriteExpressionPatchesForTarget } from "./start-generation";

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
  options: { failUpdateCall?: number } = {},
) {
  let updateCalls = 0;
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
      async updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
        updateCalls += 1;
        if (options.failUpdateCall === updateCalls) throw new Error("patch failed");
        const row = state.get(messageId);
        if (!row) throw new Error(`missing ${messageId}`);
        const extra = { ...((patch.extra as Record<string, unknown> | undefined) ?? {}) };
        const updated = { id: row.id, extra };
        state.set(messageId, updated);
        return updated as T;
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
      { failUpdateCall: 2 },
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
});

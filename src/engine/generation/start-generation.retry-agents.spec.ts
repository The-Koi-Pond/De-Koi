import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import { spriteExpressionPatchesForTarget } from "./start-generation";

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

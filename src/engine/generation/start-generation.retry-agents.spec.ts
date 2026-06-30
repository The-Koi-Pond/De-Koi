import { describe, expect, it } from "vitest";

import type { AgentResult } from "../contracts/types/agent";
import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { IntegrationGateway } from "../capabilities/integrations";
import {
  illustrationImageRequestWireBytes,
  illustrationReferenceImagesForRequest,
  illustrationReferencesForRequest,
  loadMessagesForGenerationTarget,
  retryGenerationAgents,
  shouldReturnManualIllustratorRetryWithoutCommit,
  patchMessageExtrasForGeneration,
  spriteExpressionPatchesForTarget,
} from "./start-generation";


function retryIllustrationStorage() {
  const chat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "conn-1",
    metadata: {},
    characterIds: [],
  };
  const connection = { id: "conn-1", provider: "openai", model: "chat-model" };
  const target = {
    id: "assistant-1",
    chatId: "chat-1",
    role: "assistant",
    content: "Mira catches the candle before it hits the floor.",
    createdAt: "2026-01-01T00:01:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    extra: {},
  };
  const user = {
    id: "user-1",
    chatId: "chat-1",
    role: "user",
    content: "I reach for the falling candle.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    extra: {},
  };
  const state = new Map<string, Record<string, unknown>>([[target.id, { ...target }]]);
  const writes: Array<{ type: string; entity?: string; messageId?: string }> = [];
  return {
    state,
    writes,
    storage: {
      async get(entity: string, id: string) {
        if (entity === "chats" && id === chat.id) return chat;
        if (entity === "connections" && id === connection.id) return connection;
        return null;
      },
      async list(entity: string) {
        if (entity === "agents") return [{ id: "illustrator", type: "illustrator", name: "Illustrator", enabled: true }];
        if (entity === "connections") return [connection, { id: "image-conn", provider: "image_generation", defaultForAgents: true }];
        return [];
      },
      async listChatMessages(_chatId: string, options?: { before?: unknown }) {
        return options?.before ? [user] : [user, state.get(target.id)!];
      },
      async getChatMessage(messageId: string) {
        if (messageId === target.id) return state.get(target.id)!;
        if (messageId === user.id) return user;
        return null;
      },
      async patchChatMessageExtra(messageId: string, patch: Record<string, unknown>) {
        writes.push({ type: "patchChatMessageExtra", messageId });
        const current = state.get(messageId);
        if (!current) throw new Error("missing message");
        const next = { ...current, extra: { ...(current.extra as Record<string, unknown>), ...patch } };
        state.set(messageId, next);
        return next;
      },
      async create(entity: string, value?: Record<string, unknown>) {
        writes.push({ type: "create", entity });
        return { id: `${entity}-1`, url: value?.url, ...(value ?? {}) };
      },
      async update(entity?: string) {
        writes.push({ type: "update", entity });
        return {};
      },
      async delete(entity?: string) {
        writes.push({ type: "delete", entity });
        return { deleted: false };
      },
      async createChatMessage() {
        writes.push({ type: "createChatMessage" });
        return {};
      },
      async updateChatMessage() {
        writes.push({ type: "updateChatMessage" });
        return {};
      },
      async deleteChatMessage() {
        writes.push({ type: "deleteChatMessage" });
        return { deleted: false };
      },
      async addChatMessageSwipe() {
        writes.push({ type: "addChatMessageSwipe" });
        return {};
      },
      async patchChatMetadata() {
        writes.push({ type: "patchChatMetadata" });
        return {};
      },
      async listLorebookEntries() {
        return [];
      },
    },
  };
}
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

describe("illustrationReferenceImagesForRequest", () => {
  const dataUrl = (encodedLength: number, variant = 0) => {
    const pngHeader = "iVBORw0KGgoA";
    const normalizedLength = encodedLength + ((4 - (encodedLength % 4)) % 4);
    const marker = `${"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[variant % 64]}AAA`;
    const fillerLength = Math.max(0, normalizedLength - pngHeader.length - marker.length);
    return `data:image/png;base64,${pngHeader}${"A".repeat(fillerLength)}${marker}`;
  };


  it("drops oversized and excess image references before image generation requests", () => {
    const nearLimitImage = dataUrl(8 * 1024 * 1024);
    const tooLargeImage = dataUrl(8 * 1024 * 1024 + 4);

    const images = illustrationReferenceImagesForRequest([
      nearLimitImage,
      tooLargeImage,
      ...Array.from({ length: 10 }, (_, index) => dataUrl(128 + index * 4, index)),
    ]);

    expect(images).toHaveLength(8);
    expect(images).toContain(nearLimitImage);
    expect(images).not.toContain(tooLargeImage);
  });

  it("does not add subject names for rejected duplicate reference images", () => {
    const sharedImage = dataUrl(128);
    const tooLargeImage = dataUrl(8 * 1024 * 1024 + 4);

    const references = illustrationReferencesForRequest([
      { image: sharedImage, subjectName: "Mira" },
      { image: sharedImage, subjectName: "Player" },
      { image: tooLargeImage, subjectName: "Oversized" },
    ]);

    expect(references.referenceImages).toEqual([sharedImage]);
    expect(references.referenceSubjectNames).toEqual(["Mira"]);
    expect(references.selectedReferences).toEqual([{ image: sharedImage, subjectName: "Mira" }]);
  });

  it("keeps selected reference images and subject names paired after filtering", () => {
    const keptImage = dataUrl(128, 1);
    const duplicateImage = dataUrl(128, 1);
    const tooLargeImage = dataUrl(8 * 1024 * 1024 + 4, 2);

    const references = illustrationReferencesForRequest([
      { image: keptImage, subjectName: "Mira" },
      { image: duplicateImage, subjectName: "Duplicate Mira" },
      { image: tooLargeImage, subjectName: "Oversized" },
      { image: dataUrl(132, 3), subjectName: "Player" },
    ]);

    expect(references.selectedReferences).toEqual([
      { image: keptImage, subjectName: "Mira" },
      { image: dataUrl(132, 3), subjectName: "Player" },
    ]);
    expect(references.referenceSubjectNames).toEqual(["Mira", "Player"]);
  });

  it("rejects malformed payloads and normalizes raw base64 image references", () => {
    const valid = dataUrl(128);
    const rawBase64Image = valid.split(",")[1]!;
    const malformedDataUrl = `data:image/png;base64,${"A".repeat(84)}!`;
    const decodedButNotImage = `data:image/png;base64,${"A".repeat(84)}`;

    expect(illustrationReferenceImagesForRequest([malformedDataUrl, rawBase64Image, decodedButNotImage, valid])).toEqual([
      valid,
    ]);
    expect(illustrationReferenceImagesForRequest([rawBase64Image])).toEqual([valid]);
  });

  it("caps selected references by serialized illustration request payload", () => {
    const images = illustrationReferenceImagesForRequest(
      Array.from({ length: 6 }, (_, index) => dataUrl(4 * 1024 * 1024 + index * 4, index)),
    );

    expect(illustrationImageRequestWireBytes({ referenceImages: images })).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(images.length).toBeGreaterThan(1);
    expect(images.length).toBeLessThan(6);
  });
});

describe("retryGenerationAgents manual Illustrator retries", () => {
  it("only short-circuits no-prompt manual paintbrush retries when results are Illustrator-only", () => {
    const illustratorNoPrompt = {
      agentId: "illustrator",
      agentType: "illustrator",
      type: "image_prompt",
      success: true,
      error: null,
      data: { shouldGenerate: false },
      tokensUsed: 0,
      durationMs: 0,
    } as AgentResult;
    const nonIllustratorResult = {
      agentId: "summary",
      agentType: "chat-summary",
      type: "chat_summary",
      success: true,
      error: null,
      data: { summary: "Mira caught the candle." },
      tokensUsed: 0,
      durationMs: 0,
    } as AgentResult;
    const agentTypes = new Set(["illustrator", "chat-summary"]);

    expect(
      shouldReturnManualIllustratorRetryWithoutCommit({
        hasTarget: true,
        illustratorManualRequest: true,
        agentTypes,
        results: [illustratorNoPrompt],
      }),
    ).toBe(true);
    expect(
      shouldReturnManualIllustratorRetryWithoutCommit({
        hasTarget: true,
        illustratorManualRequest: true,
        agentTypes,
        results: [illustratorNoPrompt, nonIllustratorResult],
      }),
    ).toBe(false);
  });
  it("uses selected message text as a fallback prompt when manual paintbrush retries return no image prompt", async () => {
    const { storage, writes, state } = retryIllustrationStorage();
    const imagePrompts: string[] = [];
    const llm = {
      async *stream(_request: LlmRequest) {
        yield {
          type: "token",
          text: JSON.stringify({ shouldGenerate: false, reason: "not visually significant" }),
        };
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    } as unknown as LlmGateway;
    const integrations = {
      image: {
        async generate(input: Record<string, unknown>) {
          imagePrompts.push(String(input.prompt ?? ""));
          return { base64: "QUJD", mimeType: "image/png", provider: "test-image", model: "test-model" };
        },
      },
    } as unknown as IntegrationGateway;

    const result = await retryGenerationAgents(
      { storage: storage as never, llm, integrations },
      {
        chatId: "chat-1",
        agentTypes: ["illustrator"],
        options: { forMessageId: "assistant-1", bypassActivation: true, illustratorManualRequest: true },
      },
    );

    expect(result.events.some((event) => event.type === "illustration_error")).toBe(false);
    expect(result.events.some((event) => event.type === "illustration")).toBe(true);
    expect(imagePrompts[0]).toContain("Mira catches the candle before it hits the floor.");
    expect(writes).toEqual(
      expect.arrayContaining([
        { type: "create", entity: "agent-runs" },
        { type: "create", entity: "gallery" },
        { type: "patchChatMessageExtra", messageId: "assistant-1" },
      ]),
    );
    expect((state.get("assistant-1")?.extra as { attachments?: unknown[] }).attachments).toEqual([
      expect.objectContaining({ type: "image", galleryId: "gallery-1" }),
    ]);
  });

  it("persists gallery attachments and agent results when a manual paintbrush retry returns an image prompt", async () => {
    const { storage, writes, state } = retryIllustrationStorage();
    const llm = {
      async *stream(_request: LlmRequest) {
        yield {
          type: "token",
          text: JSON.stringify({ shouldGenerate: true, prompt: "Mira catches a candle in warm light.", reason: "Scene moment" }),
        };
        yield { type: "done" };
      },
      async listModels() {
        return [];
      },
    } as unknown as LlmGateway;
    const integrations = {
      image: {
        async generate() {
          return { base64: "QUJD", mimeType: "image/png", provider: "test-image", model: "test-model" };
        },
      },
    } as unknown as IntegrationGateway;

    const result = await retryGenerationAgents(
      { storage: storage as never, llm, integrations },
      {
        chatId: "chat-1",
        agentTypes: ["illustrator"],
        options: { forMessageId: "assistant-1", bypassActivation: true, illustratorManualRequest: true },
      },
    );

    expect(result.events.some((event) => event.type === "illustration")).toBe(true);
    expect(writes).toEqual(
      expect.arrayContaining([
        { type: "create", entity: "agent-runs" },
        { type: "create", entity: "gallery" },
        { type: "patchChatMessageExtra", messageId: "assistant-1" },
      ]),
    );
    expect((state.get("assistant-1")?.extra as { attachments?: unknown[] }).attachments).toEqual([
      expect.objectContaining({ type: "image", galleryId: "gallery-1" }),
    ]);
  });
});

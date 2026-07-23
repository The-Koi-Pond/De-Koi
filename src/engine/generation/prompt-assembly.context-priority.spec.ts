import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { fitLlmRequestToContextWindow } from "./context-window";
import { assembleGenerationPrompt, collapseToSingleUserMessage } from "./prompt-assembly";

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function contextPriorityStorage(options: {
  character: Record<string, unknown>;
  memories: Record<string, unknown>[];
  regexScripts?: Record<string, unknown>[];
  promptBundle?: {
    preset: Record<string, unknown>;
    sections: Record<string, unknown>[];
    groups?: Record<string, unknown>[];
  };
}): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "prompts") return asStorageValue<T[]>(options.promptBundle ? [options.promptBundle.preset] : []);
      if (entity === "regex-scripts") return asStorageValue<T[]>(options.regexScripts ?? []);
      if (["personas", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && options.character.id === id) return asStorageValue<T>(options.character);
      if (entity === "prompts" && options.promptBundle?.preset.id === id) {
        return asStorageValue<T>(options.promptBundle.preset);
      }
      return null;
    },
    async create() {
      throw new Error("create should not be called");
    },
    async update() {
      throw new Error("update should not be called");
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages() {
      return [];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage() {
      throw new Error("createChatMessage should not be called");
    },
    async updateChatMessage() {
      throw new Error("updateChatMessage should not be called");
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return asStorageValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listChatMemories<T = unknown>() {
      return asStorageValue<T[]>(options.memories);
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listLorebookEntries() {
      return [];
    },
    async listLorebookEntriesByLorebookIds() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull<T = unknown>() {
      if (!options.promptBundle) return null;
      return asStorageValue<T>({
        preset: options.promptBundle.preset,
        sections: options.promptBundle.sections,
        groups: options.promptBundle.groups ?? [],
        choiceBlocks: [],
      });
    },
  };
}

function todayIso(): string {
  return new Date().toISOString();
}

describe("prompt context priority", () => {
  it("does not resurrect regex-removed prompt text when overflow drops another segment", async () => {
    const summaryText = Array.from({ length: 80 }, (_, index) => `Optional continuity ${index + 1}.`).join("\n\n");
    const assembly = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira is a guide. REMOVE_THIS_PRIVATE_NOTE {{// REMOVE_THIS_PROMPT_COMMENT}}",
          },
        },
        memories: [],
        regexScripts: [
          {
            id: "remove-private-note",
            enabled: true,
            promptOnly: true,
            placement: ["ai_output"],
            findRegex: "REMOVE_THIS_PRIVATE_NOTE",
            replaceString: "",
            flags: "g",
          },
        ],
      }),
      {
        chat: {
          id: "chat-regex-overflow",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: false, conversationSummary: summaryText },
        },
        storedMessages: [
          ...Array.from({ length: 6 }, (_, index) => [
            { id: `old-user-${index}`, role: "user", content: `Old question ${index}. ${"detail ".repeat(40)}` },
            {
              id: `old-assistant-${index}`,
              role: "assistant",
              content: `Old answer ${index}. ${"detail ".repeat(40)}`,
            },
          ]).flat(),
          { id: "current", role: "user", content: "Continue safely." },
        ],
        connection: { maxContext: 2_000 },
        request: {},
        latestUserInput: "Continue safely.",
      },
    );

    expect(assembly.messages.map((message) => message.content).join("\n")).not.toContain("REMOVE_THIS_PRIVATE_NOTE");
    expect(assembly.messages.map((message) => message.content).join("\n")).not.toContain("REMOVE_THIS_PROMPT_COMMENT");

    const fitted = fitLlmRequestToContextWindow(assembly.messages, { maxTokens: 400 }, { maxContext: 2_000 });
    const fittedText = fitted.messages.map((message) => message.content).join("\n");
    expect(fittedText).not.toContain("REMOVE_THIS_PRIVATE_NOTE");
    expect(fittedText).not.toContain("REMOVE_THIS_PROMPT_COMMENT");
    expect(fittedText).toContain("Mira is a guide.");
    expect(fittedText).toContain("Continue safely.");
    expect(fitted.decision?.removedMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ contextKind: "history" })]),
    );
  });

  it("retains character and required preset depth instructions during overflow", async () => {
    const summaryText = Array.from({ length: 120 }, (_, index) => `Optional old summary ${index + 1}.`).join("\n\n");
    const oldHistory = Array.from({ length: 8 }, (_, index) => [
      { id: `old-user-${index}`, role: "user", content: `Old question ${index}. ${"detail ".repeat(30)}` },
      { id: `old-assistant-${index}`, role: "assistant", content: `Old answer ${index}. ${"detail ".repeat(30)}` },
    ]).flat();
    const assembly = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira guides the festival.",
            depth_prompt: { prompt: "REQUIRED CHARACTER DEPTH INSTRUCTION", depth: 1, role: "system" },
          },
        },
        memories: [],
        promptBundle: {
          preset: { id: "depth-preset", parameters: { strictRoleFormatting: true } },
          sections: [
            {
              id: "core",
              enabled: true,
              sortOrder: 1,
              name: "Core",
              role: "system",
              content: "REQUIRED CORE PRESET",
            },
            {
              id: "depth-directive",
              enabled: true,
              sortOrder: 2,
              name: "Required Depth Directive",
              role: "system",
              content: "REQUIRED PRESET DEPTH DIRECTIVE",
              injectionPosition: "depth",
              injectionDepth: 1,
            },
          ],
        },
      }),
      {
        chat: {
          id: "chat-depth",
          mode: "roleplay",
          characterIds: ["mira"],
          promptPresetId: "depth-preset",
          metadata: { enableMemoryRecall: false, conversationSummary: summaryText },
        },
        storedMessages: [...oldHistory, { id: "current", role: "user", content: "Continue the festival." }],
        connection: { maxContext: 1_200 },
        request: { promptPresetId: "depth-preset" },
        latestUserInput: "Continue the festival.",
      },
    );

    const fitted = fitLlmRequestToContextWindow(assembly.messages, { maxTokens: 500 }, { maxContext: 1_200 });
    const text = fitted.messages.map((message) => message.content).join("\n");
    expect(text).toContain("REQUIRED CHARACTER DEPTH INSTRUCTION");
    expect(text).toContain("REQUIRED PRESET DEPTH DIRECTIVE");
    expect(text).toContain("Continue the festival.");
    expect(fitted.decision?.removedMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ contextKind: "history" })]),
    );
  });

  it("keeps optional classification after single-user provider formatting", () => {
    const formatted = collapseToSingleUserMessage([
      { role: "system", content: "Required system", contextKind: "prompt" },
      { role: "system", content: "Optional summary. ".repeat(160), contextKind: "summary" },
      { role: "user", content: "Current request", contextKind: "history" },
    ]);

    const fitted = fitLlmRequestToContextWindow(formatted, { maxTokens: 400 }, { maxContext: 1_200 });

    expect(fitted.messages).toHaveLength(1);
    expect(fitted.messages[0]?.role).toBe("user");
    expect(fitted.messages[0]?.content).toContain("[SYSTEM]\nRequired system");
    expect(fitted.messages[0]?.content).toContain("Current request");
    expect(fitted.messages[0]?.content).not.toContain("Optional summary");
  });

  it("keeps default strict-role requests provider-equivalent under budget and removes fallback summary first on overflow", async () => {
    const summaryText = Array.from({ length: 40 }, (_, index) => `Festival continuity paragraph ${index + 1}.`).join(
      "\n\n",
    );
    const assembly = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: { id: "mira", data: { name: "Mira", description: "Mira is a careful festival guide." } },
        memories: [],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: {
            enableMemoryRecall: false,
            conversationSummary: summaryText,
          },
        },
        storedMessages: [
          { id: "old-user", role: "user", content: "Tell me about the preparations." },
          { id: "old-assistant", role: "assistant", content: "The lanterns are ready." },
          { id: "current", role: "user", content: "What happens next?" },
        ],
        connection: { maxContext: 1_600 },
        request: {},
        latestUserInput: "What happens next?",
      },
    );
    const originalText = assembly.messages.map((message) => message.content).join("\n---\n");
    expect(
      assembly.messages.some((message) =>
        message.contextSegments?.some((segment) => segment.contextKind === "summary"),
      ),
    ).toBe(true);

    const underBudget = fitLlmRequestToContextWindow(assembly.messages, { maxTokens: 400 }, { maxContext: 8_000 });
    expect(underBudget.messages).toBe(assembly.messages);
    expect(underBudget.messages.map((message) => message.content).join("\n---\n")).toBe(originalText);

    const fitted = fitLlmRequestToContextWindow(assembly.messages, { maxTokens: 500 }, { maxContext: 1_600 });
    const fittedText = fitted.messages.map((message) => message.content).join("\n");
    expect(fittedText).not.toContain("Festival continuity paragraph 1.");
    expect(fittedText).toContain("Mira is a careful festival guide.");
    expect(fittedText).toContain("What happens next?");
    expect(fitted.decision?.removedMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ contextKind: "summary" })]),
    );
  });

  it("keeps full history when summary metadata cannot prove contiguous coverage", async () => {
    const storedMessages = Array.from({ length: 12 }, (_, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `history ${index + 1}`,
    }));
    const summaryEntry = {
      id: "continuity",
      kind: "rolling",
      origin: "manual",
      title: "Continuity",
      content: "The lantern promise remains unresolved.",
      enabled: true,
      sourceMode: "last",
      tokenEstimate: 10,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const assemble = (entry: Record<string, unknown>) =>
      assembleGenerationPrompt(
        contextPriorityStorage({
          character: { id: "mira", data: { name: "Mira", description: "Mira remembers promises." } },
          memories: [],
        }),
        {
          chat: {
            id: "chat-1",
            mode: "conversation",
            characterIds: ["mira"],
            metadata: {
              enableMemoryRecall: false,
              summaryTailMessages: 2,
              summaryEntries: [entry],
            },
          },
          storedMessages,
          connection: { provider: "openai", model: "qa-model" },
          request: {},
          latestUserInput: "What happens next?",
        },
      );

    const manual = await assemble(summaryEntry);
    const covered = await assemble({
      ...summaryEntry,
      messageIds: storedMessages.slice(0, 10).map((message) => message.id),
    });
    const historyCount = (result: Awaited<ReturnType<typeof assembleGenerationPrompt>>) =>
      result.previewMessages.filter((message) => message.contextKind === "history").length;

    expect(historyCount(manual)).toBe(12);
    expect(historyCount(covered)).toBe(12);
    expect(covered.previewMessages.map((message) => message.content).join("\n")).toContain("history 12");
  });

  it("skips recalled memories already present in same-day character memories while keeping distinct recall", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: {
            name: "Mira",
            description: "Mira is a festival bard.",
            extensions: {
              characterMemories: [
                {
                  createdAt: todayIso(),
                  from: "user",
                  summary: "Mira keeps the silver bell braid for the festival.",
                },
              ],
            },
          },
        },
        memories: [
          {
            id: "duplicate-memory",
            content: "Mira keeps the silver bell braid for the festival.",
            createdAt: "2025-01-01T00:00:00.000Z",
            firstMessageAt: "2025-01-01T00:00:00.000Z",
            lastMessageAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "distinct-memory",
            content: "Mira promised to bring the jade umbrella to the festival.",
            createdAt: "2025-01-02T00:00:00.000Z",
            firstMessageAt: "2025-01-02T00:00:00.000Z",
            lastMessageAt: "2025-01-02T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "What does Mira remember about the festival?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Does Mira remember the silver bell braid and jade umbrella for the festival?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    const recallMarker = "The following are recalled fragments from earlier in this chat.";
    const recallBlockText = promptText.slice(promptText.indexOf(recallMarker));

    expect(promptText).toContain("Mira keeps the silver bell braid for the festival.");
    expect(recallBlockText).toContain("Mira promised to bring the jade umbrella to the festival.");
    expect(recallBlockText).not.toContain("Mira keeps the silver bell braid for the festival.");
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory_recall",
          status: "skipped",
          sourceId: "duplicate-memory",
          metadata: expect.objectContaining({ reason: "overlaps_character_memory" }),
        }),
      ]),
    );
  });

  it("does not recall a transcript chunk whose source message is already in visible history", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "harlequin",
          data: { name: "Harlequin", description: "Harlequin is a theatrical provocateur." },
        },
        memories: [
          {
            id: "visible-transcript-memory",
            status: "active",
            pinned: true,
            memoryKind: "transcript",
            content: "Harlequin: I reminded Jester to behave.",
            messageIds: ["previous-assistant"],
            createdAt: "2026-07-23T22:43:38.000Z",
            firstMessageAt: "2026-07-23T22:43:38.000Z",
            lastMessageAt: "2026-07-23T22:43:38.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-group",
          mode: "conversation",
          characterIds: ["harlequin"],
          metadata: { enableMemoryRecall: true },
        },
        storedMessages: [
          {
            id: "previous-assistant",
            role: "assistant",
            characterId: "harlequin",
            content: "Harlequin: I reminded Jester to behave.",
            createdAt: "2026-07-23T22:43:38.000Z",
          },
          {
            id: "current-user",
            role: "user",
            content: "YOU? reminding HIM to behave?",
            createdAt: "2026-07-23T22:44:00.000Z",
          },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { historyLimit: 2 },
        latestUserInput: "YOU? reminding HIM to behave?",
      },
    );

    expect(result.messages.map((message) => String(message.content ?? "")).join("\n")).not.toContain("<memories>");
    expect(result.contextAttributionItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory_recall",
          status: "injected",
          sourceId: "visible-transcript-memory",
        }),
      ]),
    );
  });

  it("still recalls transcript chunks older than the visible-history window", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "harlequin",
          data: { name: "Harlequin", description: "Harlequin remembers old promises." },
        },
        memories: [
          {
            id: "older-transcript-memory",
            status: "active",
            pinned: true,
            memoryKind: "transcript",
            content: "Harlequin promised to return the moonlit silver mask.",
            messageIds: ["old-assistant"],
            createdAt: "2026-06-01T10:00:00.000Z",
            firstMessageAt: "2026-06-01T10:00:00.000Z",
            lastMessageAt: "2026-06-01T10:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-group",
          mode: "conversation",
          characterIds: ["harlequin"],
          metadata: { enableMemoryRecall: true },
        },
        storedMessages: [
          {
            id: "old-assistant",
            role: "assistant",
            content: "Harlequin promised to return the moonlit silver mask.",
            createdAt: "2026-06-01T10:00:00.000Z",
          },
          {
            id: "intervening-user",
            role: "user",
            content: "Much later, the scene changed.",
            createdAt: "2026-07-23T22:42:00.000Z",
          },
          {
            id: "recent-assistant",
            role: "assistant",
            content: "Harlequin waits by the curtain.",
            createdAt: "2026-07-23T22:43:00.000Z",
          },
          {
            id: "current-user",
            role: "user",
            content: "What happened to the moonlit silver mask?",
            createdAt: "2026-07-23T22:44:00.000Z",
          },
        ],
        connection: { provider: "openai", model: "qa-model" },
        request: { historyLimit: 2 },
        latestUserInput: "What happened to the moonlit silver mask?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("<memories>");
    expect(promptText).toContain("Harlequin promised to return the moonlit silver mask.");
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "memory_recall",
          status: "injected",
          snippet: "Harlequin promised to return the moonlit silver mask.",
        }),
      ]),
    );
  });

  it("uses active migrated canonical memories while ignoring inactive legacy projections", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: { name: "Mira", description: "Mira remembers careful details." },
        },
        memories: [
          {
            id: "migrated-summary",
            canonicalMemoryVersion: 1,
            memoryKind: "summary",
            scopeType: "chat",
            scopeId: "chat-1",
            legacySourceLane: "chats.metadata.summaryEntries",
            legacySourceId: "summary-entry:old",
            content: "Mira knows the lantern key opens the archive gate.",
            createdAt: "2025-01-01T00:00:00.000Z",
            firstMessageAt: "2025-01-01T00:00:00.000Z",
            lastMessageAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "deleted-legacy",
            canonicalMemoryVersion: 1,
            memoryKind: "manual",
            status: "deleted",
            content: "Mira thinks the archive key was thrown away.",
            createdAt: "2025-01-02T00:00:00.000Z",
            firstMessageAt: "2025-01-02T00:00:00.000Z",
            lastMessageAt: "2025-01-02T00:00:00.000Z",
          },
          {
            id: "wrong-legacy",
            canonicalMemoryVersion: 1,
            memoryKind: "imported",
            status: "wrong",
            content: "Mira thinks the archive key is silver.",
            createdAt: "2025-01-03T00:00:00.000Z",
            firstMessageAt: "2025-01-03T00:00:00.000Z",
            lastMessageAt: "2025-01-03T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "What opens the archive gate?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "What does Mira know about the lantern key and archive gate?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("Mira knows the lantern key opens the archive gate.");
    expect(promptText).not.toContain("thrown away");
    expect(promptText).not.toContain("archive key is silver");
  });

  it("filters superseded canonical memories while retaining replacements", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: { name: "Mira", description: "Mira updates continuity when facts change." },
        },
        memories: [
          {
            id: "old-mask-location",
            canonicalMemoryVersion: 1,
            memoryKind: "manual",
            status: "active",
            supersededAt: "2026-01-02T00:00:00.000Z",
            supersededByMemoryId: "new-mask-location",
            content: "Mira believes the fox mask is hidden beneath the pier.",
            createdAt: "2026-01-01T00:00:00.000Z",
            firstMessageAt: "2026-01-01T00:00:00.000Z",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "new-mask-location",
            canonicalMemoryVersion: 1,
            memoryKind: "correction",
            status: "active",
            correctionOfMemoryId: "old-mask-location",
            content: "Mira knows the fox mask is locked in the cedar cabinet.",
            createdAt: "2026-01-02T00:00:00.000Z",
            firstMessageAt: "2026-01-02T00:00:00.000Z",
            lastMessageAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "conversation",
          characterIds: ["mira"],
          metadata: { enableMemoryRecall: true, memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "Where is the fox mask now?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Where is the fox mask now?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("fox mask is locked in the cedar cabinet");
    expect(promptText).not.toContain("hidden beneath the pier");
  });
  it("uses the shared roleplay Memory Recall default when metadata omits the explicit flag", async () => {
    const result = await assembleGenerationPrompt(
      contextPriorityStorage({
        character: {
          id: "mira",
          data: { name: "Mira", description: "Mira remembers careful roleplay continuity." },
        },
        memories: [
          {
            id: "roleplay-memory",
            content: "Mira hid the archive key under the blue lantern.",
            createdAt: "2026-01-01T00:00:00.000Z",
            firstMessageAt: "2026-01-01T00:00:00.000Z",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      {
        chat: {
          id: "chat-1",
          mode: "roleplay",
          characterIds: ["mira"],
          metadata: { memoryRecallReadBehindMessages: 0 },
        },
        storedMessages: [{ id: "latest", role: "user", content: "Where is the archive key?" }],
        connection: { provider: "openai", model: "qa-model" },
        request: {},
        latestUserInput: "Where did Mira hide the archive key and blue lantern?",
      },
    );

    const promptText = result.messages.map((message) => String(message.content ?? "")).join("\n");
    expect(promptText).toContain("<memories>");
    expect(promptText).toContain("Mira hid the archive key under the blue lantern.");
  });
});

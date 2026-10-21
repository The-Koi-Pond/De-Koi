import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { assembleGenerationPrompt, ROLEPLAY_FILLER_NOTE, ROLEPLAY_HABITS_NOTE_HEADER } from "./prompt-assembly";
import { withModeProseShapeGuidance } from "./prose-shape-guidance";

const CHARACTER_FIRST_MESSAGE = "MIRA_FIRST_MESSAGE_SENTINEL: The archive doors complain before Mira does.";
const CHARACTER_EXAMPLE_DIALOGUE =
  'MIRA_EXAMPLE_SENTINEL: {{char}}: "Catalog the lie first. The truth will still be there when we finish."';

function storage(): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (["prompts", "personas", "regex-scripts", "lorebooks", "agents"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters" && id === "mira") {
        return {
          id: "mira",
          data: {
            name: "Mira",
            description: "A careful archivist.",
            first_mes: CHARACTER_FIRST_MESSAGE,
            mes_example: CHARACTER_EXAMPLE_DIALOGUE,
          },
        } as T;
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
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>() {
      return {} as T;
    },
    async patchChatSummaries<T = unknown>() {
      return {} as T;
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return {} as T;
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
    async promptFull() {
      return null;
    },
  };
}

const repeatedHistory = [
  { id: "assistant-1", role: "assistant", content: "For a long moment, Mira waits. What happened?" },
  { id: "user-1", role: "user", content: "I listen." },
  { id: "assistant-2", role: "assistant", content: "For a long moment, she watches. What did you see?" },
  { id: "user-2", role: "user", content: "I stay quiet." },
  { id: "assistant-3", role: "assistant", content: "For a long moment, the rain falls. Will you answer?" },
  { id: "user-3", role: "user", content: "I wait." },
];

function promptText(result: Awaited<ReturnType<typeof assembleGenerationPrompt>>): string {
  return result.messages.map((message) => message.content).join("\n");
}

describe("Roleplay quality prompt guidance", () => {
  it("preserves character-owned voice examples beside one generic prose guide", async () => {
    const assembled = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-voice", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: [],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Open the archive.",
    });
    const messages = withModeProseShapeGuidance(assembled.messages, "roleplay");
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain(CHARACTER_FIRST_MESSAGE);
    expect(text).toContain('MIRA_EXAMPLE_SENTINEL: Mira: "Catalog the lie first.');
    expect(text).not.toContain("Automatic:");
    expect(text).not.toContain("Cleaner:");
    expect(messages.filter((message) => message.displayName === "Roleplay Prose Guidance")).toHaveLength(1);
  });

  it("defaults roleplay history to the latest 50 messages", async () => {
    const history = Array.from({ length: 60 }, (_, index) => ({
      id: `history-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `HISTORY_SENTINEL_${String(index + 1).padStart(2, "0")}`,
    }));
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-bounded", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: history,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "HISTORY_SENTINEL_60",
    });

    const text = promptText(result);
    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(50);
    expect(text).not.toContain("HISTORY_SENTINEL_10");
    expect(text).toContain("HISTORY_SENTINEL_11");
  });

  it("honors an explicit roleplay history limit above the default", async () => {
    const history = Array.from({ length: 60 }, (_, index) => ({
      id: `history-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `EXPLICIT_HISTORY_${String(index + 1).padStart(2, "0")}`,
    }));
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-explicit", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: history,
      connection: { provider: "openai", model: "qa-model" },
      request: { historyLimit: 60 },
      latestUserInput: "EXPLICIT_HISTORY_60",
    });

    expect(result.messages.filter((message) => message.contextKind === "history")).toHaveLength(60);
    expect(promptText(result)).toContain("EXPLICIT_HISTORY_01");
  });

  it.each(["roleplay", "visual_novel"])("injects and attributes bounded guidance in %s mode", async (mode) => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-1",
        mode,
        characterIds: ["mira"],
        metadata: {},
        promptVariables: {
          agencyStrictness: "strict agency: never write the user's deliberate actions.",
        },
      },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I wait.",
    });

    // The habit note rides on the latest user turn, where it is followed; a system block would be folded into the
    // system prompt by some providers, far behind the history.
    const latestUser = result.messages.filter((message) => message.role === "user").at(-1);
    expect(latestUser?.content).toContain(ROLEPLAY_HABITS_NOTE_HEADER);
    expect(latestUser?.content).toContain('The stock phrase "for a long moment"');
    expect(latestUser?.content).toContain(ROLEPLAY_FILLER_NOTE);
    expect(
      result.messages.filter((message) => message.role === "system" && message.content.includes("Habits to avoid")),
    ).toEqual([]);
    expect(result.contextAttributionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_injection",
          label: "Roleplay quality",
          status: "injected",
          sourceId: "core-roleplay-quality",
        }),
      ]),
    );
    expect(result.roleplayAgencyContract).toContain("strict agency:");
  });

  it("does not add Roleplay guidance to Conversation mode", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-1", mode: "conversation", characterIds: ["mira"], metadata: {} },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "I wait.",
    });

    expect(promptText(result)).not.toContain(ROLEPLAY_HABITS_NOTE_HEADER);
    expect(promptText(result)).not.toContain(ROLEPLAY_FILLER_NOTE);
    expect(promptText(result)).not.toContain("roleplay_quality");
    expect(result.contextAttributionItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: "core-roleplay-quality" })]),
    );
  });

  it("honors an explicit request for questions while keeping unrelated repetition guidance", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: { id: "chat-1", mode: "roleplay", characterIds: ["mira"], metadata: {} },
      storedMessages: repeatedHistory,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "Keep asking me questions until we solve it.",
    });

    const text = promptText(result);
    expect(text).toContain('The stock phrase "for a long moment"');
    expect(text).not.toContain("Don't end this reply with another question");
  });

  it("puts the habit scan in the Conversation freshness note", async () => {
    const result = await assembleGenerationPrompt(storage(), {
      chat: {
        id: "chat-new",
        mode: "conversation",
        characterIds: ["mira"],
        metadata: {
          habitScan: {
            version: 2,
            throughMessageId: "assistant-2",
            scannedReplies: 2,
            habits: [{ habit: "Ending on a bedtime order", replies: 2, quotes: ["Go to bed."] }],
            scannedAt: "2026-10-20T12:00:00.000Z",
          },
        },
      },
      storedMessages: [
        { id: "assistant-1", role: "assistant", content: "ok. go to bed." },
        { id: "user-1", role: "user", content: "no" },
        { id: "assistant-2", role: "assistant", content: "fine. go to bed." },
        { id: "user-2", role: "user", content: "what are you doing" },
      ],
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "what are you doing",
    });

    const latestUser = result.messages.filter((message) => message.role === "user").at(-1);
    expect(latestUser?.content).toContain("conversation_freshness");
    expect(latestUser?.content).toContain(
      '- Ending on a bedtime order (in 2 of the last 2 replies, e.g. "Go to bed."). Leave it out of this reply',
    );
    expect(promptText(result)).not.toContain(ROLEPLAY_HABITS_NOTE_HEADER);
  });
});

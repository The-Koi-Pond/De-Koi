import { describe, expect, it } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import { buildAutomaticMemoryCaptureContext } from "./automatic-memory-context";
import type { JsonRecord } from "./runtime-records";

function savedMessage(
  id: string,
  role: string,
  content: string,
  createdAt: string,
  overrides: JsonRecord = {},
): JsonRecord {
  return {
    id,
    chatId: "chat-1",
    role,
    content,
    characterId: role === "assistant" ? "pierrot" : null,
    createdAt,
    ...overrides,
  };
}

function storageForContext(messages: JsonRecord[], persona: JsonRecord | null = { id: "persona-1", name: "Celia" }) {
  return {
    async get<T = unknown>(entity: string, id: string): Promise<T | null> {
      if (entity === "personas" && id === "persona-1") return persona as T | null;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
  } as unknown as StorageGateway;
}

describe("automatic memory capture context", () => {
  it("uses the configured persona and character names", async () => {
    const user = savedMessage("user-current", "user", "My cat is Miso.", "2026-01-01T00:07:00.000Z");
    const assistant = savedMessage(
      "assistant-current",
      "assistant",
      "I will remember that.",
      "2026-01-01T00:08:00.000Z",
    );

    const context = await buildAutomaticMemoryCaptureContext(storageForContext([user, assistant]), {
      chat: { id: "chat-1", personaId: "persona-1" },
      characters: [{ id: "pierrot", name: "Pierrot" }],
      savedUserMessage: user,
      savedAssistantMessage: assistant,
    });

    expect(context?.userLabel).toBe("Celia");
    expect(context?.characterLabels).toEqual({ pierrot: "Pierrot" });
    expect(context?.sourceMessages.map((message) => message.speakerLabel)).toEqual(["Celia", "Pierrot"]);
  });

  it("uses the canonical user token when the chat has no persona", async () => {
    const user = savedMessage("user-current", "user", "My cat is Miso.", "2026-01-01T00:07:00.000Z");
    const assistant = savedMessage(
      "assistant-current",
      "assistant",
      "I will remember that.",
      "2026-01-01T00:08:00.000Z",
    );

    const context = await buildAutomaticMemoryCaptureContext(storageForContext([user, assistant], null), {
      chat: { id: "chat-1", personaId: null },
      characters: [{ id: "pierrot", data: { name: "Pierrot" } }],
      savedUserMessage: user,
      savedAssistantMessage: assistant,
    });

    expect(context?.userLabel).toBe("{{user}}");
    expect(context?.sourceMessages[0]?.speakerLabel).toBe("{{user}}");
    expect(context?.sourceMessages[1]?.speakerLabel).toBe("Pierrot");
  });

  it("keeps only six preceding visible same-chat messages in chronological order", async () => {
    const prior = Array.from({ length: 9 }, (_, index) =>
      savedMessage(
        `prior-${index}`,
        index % 2 === 0 ? "user" : "assistant",
        `prior message ${index}`,
        `2026-01-01T00:0${index}:00.000Z`,
      ),
    );
    const user = savedMessage("user-current", "user", "What happened?", "2026-01-01T00:10:00.000Z");
    const assistant = savedMessage(
      "assistant-current",
      "assistant",
      "The circus accident happened.",
      "2026-01-01T00:11:00.000Z",
    );
    const hidden = savedMessage("hidden", "user", "secret", "2026-01-01T00:09:30.000Z", {
      extra: { hiddenFromAI: true },
    });
    const empty = savedMessage("empty", "user", "   ", "2026-01-01T00:09:40.000Z");
    const otherChat = savedMessage("other-chat", "user", "wrong chat", "2026-01-01T00:09:50.000Z", {
      chatId: "chat-2",
    });

    const context = await buildAutomaticMemoryCaptureContext(
      storageForContext([...prior, hidden, empty, otherChat, user, assistant]),
      {
        chat: { id: "chat-1", personaId: "persona-1" },
        characters: [{ id: "pierrot", name: "Pierrot" }],
        savedUserMessage: user,
        savedAssistantMessage: assistant,
      },
    );

    expect(context?.sourceMessages.map((message) => message.id)).toEqual(["user-current", "assistant-current"]);
    expect(context?.referenceMessages.map((message) => message.id)).toEqual([
      "prior-3",
      "prior-4",
      "prior-5",
      "prior-6",
      "prior-7",
      "prior-8",
    ]);
    expect([...(context?.referenceMessages ?? []), ...(context?.sourceMessages ?? [])]).toHaveLength(8);
  });

  it("excludes reference messages that cannot be proven to precede the source exchange", async () => {
    const validPrior = savedMessage("valid-prior", "user", "The circus accident?", "2026-01-01T00:09:00.000Z");
    const missingTimestamp = savedMessage("missing-time", "user", "Unknown order.", "");
    const sameTimestamp = savedMessage("same-time", "user", "Not earlier.", "2026-01-01T00:10:00.000Z");
    const futureTimestamp = savedMessage("future-time", "user", "From the future.", "2026-01-01T00:11:00.000Z");
    const user = savedMessage("user-current", "user", "What happened?", "2026-01-01T00:10:00.000Z");
    const assistant = savedMessage(
      "assistant-current",
      "assistant",
      "I do not want to talk about it.",
      "2026-01-01T00:10:30.000Z",
    );

    const context = await buildAutomaticMemoryCaptureContext(
      storageForContext([missingTimestamp, validPrior, sameTimestamp, user, assistant, futureTimestamp]),
      {
        chat: { id: "chat-1", personaId: "persona-1" },
        characters: [{ id: "pierrot", name: "Pierrot" }],
        savedUserMessage: user,
        savedAssistantMessage: assistant,
      },
    );

    expect(context?.referenceMessages.map((message) => message.id)).toEqual(["valid-prior"]);
  });

  it("labels an unknown assistant explicitly instead of inventing a name", async () => {
    const assistant = savedMessage("assistant-current", "assistant", "Someone left.", "2026-01-01T00:08:00.000Z", {
      characterId: "missing-character",
    });

    const context = await buildAutomaticMemoryCaptureContext(storageForContext([assistant]), {
      chat: { id: "chat-1", personaId: "persona-1" },
      characters: [],
      savedAssistantMessage: assistant,
    });

    expect(context?.sourceMessages[0]?.speakerLabel).toBe("Unattributed assistant");
  });
});

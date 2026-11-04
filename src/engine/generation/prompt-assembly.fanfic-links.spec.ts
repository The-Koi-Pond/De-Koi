import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { createFanficState, defaultFanficRequest } from "../modes/fanfic/request";
import { assembleGenerationPrompt } from "./prompt-assembly";
import type { JsonRecord } from "./runtime-records";

const outline = {
  title: "Collection",
  summary: "",
  chapters: [1, 2, 3].map((number) => ({ number, title: `Ch ${number}`, summary: "Beats." })),
};
const fanfic = { ...createFanficState(defaultFanficRequest()), outline, outlineApproved: true };

const fic: JsonRecord = {
  id: "fic",
  name: "My fic",
  mode: "fanfic",
  characterIds: [],
  metadata: { fanfic, fanficLinkedChatIds: ["rp"] },
};
const rp: JsonRecord = {
  id: "rp",
  name: "Big Top",
  mode: "roleplay",
  characterIds: ["harl"],
  metadata: { fanficLink: { ficChatId: "fic" } },
};
const chapter = { id: "c1", chatId: "fic", role: "assistant", content: "The bell was silver.", createdAt: "2026-01-01T10:00:00Z" };
const rpMessages = [
  { id: "r1", chatId: "rp", role: "user", content: "The bell rang twice at midnight.", createdAt: "2026-01-01T12:00:00Z" },
];

function storage(): StorageGateway {
  const chats = new Map([
    ["fic", fic],
    ["rp", rp],
  ]);
  return {
    async list<T = unknown>(): Promise<T[]> {
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "characters" && id === "harl") return { id, name: "Harlequin", data: { name: "Harlequin" } } as T;
      return null;
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return (chatId === "fic" ? [chapter] : chatId === "rp" ? rpMessages : []) as T[];
    },
  } as unknown as StorageGateway;
}

function prompt(messages: Array<{ content: unknown }>): string {
  return messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n\n");
}

describe("prompt assembly with a fic linked to a roleplay", () => {
  it("gives a chapter write what happened in the roleplay since the previous chapter", async () => {
    const assembled = await assembleGenerationPrompt(storage(), {
      chat: fic,
      storedMessages: [chapter],
      connection: { provider: "openai", model: "qa-model" },
      request: { generationGuide: "Write chapter 2 now.", generationGuideSource: "fanfic_chapter" },
      latestUserInput: "",
    });
    const text = prompt(assembled.messages);
    expect(text).toContain("## Meanwhile, in the linked chats");
    expect(text).toContain("The user: The bell rang twice at midnight.");
  });

  it("leaves the roleplay out of a rewrite with notes or a polish", async () => {
    const assembled = await assembleGenerationPrompt(storage(), {
      chat: fic,
      storedMessages: [chapter],
      connection: { provider: "openai", model: "qa-model" },
      request: { generationGuide: "Rewrite chapter 1.", generationGuideSource: "fanfic_revise" },
      latestUserInput: "",
    });
    expect(prompt(assembled.messages)).not.toContain("Meanwhile, in the linked chats");
  });

  it("gives the roleplay's replies where the fic stands", async () => {
    const assembled = await assembleGenerationPrompt(storage(), {
      chat: rp,
      storedMessages: rpMessages,
      connection: { provider: "openai", model: "qa-model" },
      request: {},
      latestUserInput: "The bell rang twice at midnight.",
    });
    const text = prompt(assembled.messages);
    expect(text).toContain('This chat is linked to the fic "Collection": 1 of 3 planned chapters written.');
    // The block is wrapped and indented like the other context blocks.
    expect(text).toMatch(/The latest chapter \(1\) ends:\s+The bell was silver\./);
  });
});

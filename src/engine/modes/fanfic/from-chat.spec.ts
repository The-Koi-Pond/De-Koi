import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import { readFanficDraftRequest, readFanficSource, startFanficFromChat } from "./from-chat";
import { defaultFanficRequest } from "./request";
import { saveFanficRequest } from "./request-save";

const draft = {
  fandom: "Original Work",
  existingCanon: false,
  characters: ["Vex", "Rook"],
  relationships: ["Rook/Vex"],
  rating: "mature",
  warnings: ["graphic_violence", "not_a_warning"],
  tags: ["Enemies to Lovers"],
  setting: "canon",
  settingNotes: "A floating city. Rook is a smuggler with a debt.",
  pov: "third_limited",
  povCharacter: "Rook",
  chapterCount: 40,
  prompt: "Rook steals Vex's map, they get caught together, and the chat stops as the city falls.",
  adultsConfirmed: true,
};

function setup(options: { mode?: string; messages?: Record<string, unknown>[]; maxContext?: number } = {}) {
  const chats = new Map<string, Record<string, unknown>>([
    [
      "rp",
      {
        id: "rp",
        name: "Sky Heist",
        mode: options.mode ?? "roleplay",
        characterIds: ["vex"],
        personaId: "me",
        connectionId: "rp-conn",
        metadata: { activeLorebookIds: ["city-lore"], summary: "Earlier, Rook lost a bet to Vex." },
      },
    ],
  ]);
  const messages = options.messages ?? [
    {
      id: "1",
      chatId: "rp",
      role: "assistant",
      characterId: "vex",
      content: "Give back the map.",
      createdAt: "2026-01-01T00:00:01Z",
    },
    { id: "2", chatId: "rp", role: "user", content: "Make me.", createdAt: "2026-01-01T00:00:02Z" },
    {
      id: "3",
      chatId: "rp",
      role: "narrator",
      content: "Scene so far: they were caught.",
      extra: { hiddenFromUser: true },
      createdAt: "2026-01-01T00:00:03Z",
    },
  ];
  const created: Record<string, unknown>[] = [];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections" && id === "rp-conn") {
        return { id, provider: "openai", maxContext: options.maxContext ?? 0 } as T;
      }
      if (entity === "characters" && id === "vex")
        return { id, data: { name: "Vex", description: "A cartographer." } } as T;
      if (entity === "personas" && id === "me") return { id, data: { name: "Rook", description: "A smuggler." } } as T;
      return null;
    },
    async list<T = unknown>(): Promise<T[]> {
      return [];
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `fic-${created.length + 1}`, ...value };
      created.push(row);
      return row as T;
    },
  } as unknown as StorageGateway;
  return { storage, created };
}

function llmReplying(...replies: string[]) {
  const requests: LlmRequest[] = [];
  const llm = {
    async complete(request: LlmRequest) {
      requests.push(request);
      return replies[Math.min(requests.length - 1, replies.length - 1)]!;
    },
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("making a fic from a chat", () => {
  it("drafts the request from the chat on the chat's model and opens a new fic with it", async () => {
    const { storage, created } = setup();
    const { llm, requests } = llmReplying(JSON.stringify(draft));
    const fic = await startFanficFromChat({ storage, llm }, { chatId: "rp" });

    expect(requests[0]!.connectionId).toBe("rp-conn");
    const prompt = requests[0]!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Vex: A cartographer.");
    expect(prompt).toContain("## The user's character\nRook: A smuggler.");
    expect(prompt).toContain("Earlier, Rook lost a bet to Vex.");
    expect(prompt).toContain(
      "Vex: Give back the map.\n\nRook: Make me.\n\n(Story note) Scene so far: they were caught.",
    );

    expect(created).toHaveLength(1);
    expect(fic).toMatchObject({
      name: "Sky Heist (fic)",
      mode: "fanfic",
      characterIds: ["vex"],
      personaId: "me",
      connectionId: "rp-conn",
    });
    const metadata = fic.metadata as Record<string, unknown>;
    expect(metadata.activeLorebookIds).toEqual(["city-lore"]);
    expect(readFanficSource(metadata)).toEqual({ version: 1, chatId: "rp", mode: "roleplay", name: "Sky Heist" });
    const request = readFanficDraftRequest(metadata)!;
    expect(request).toMatchObject({
      fandom: "Original Work",
      characters: ["Vex", "Rook"],
      relationships: ["Rook/Vex"],
      rating: "mature",
      warnings: ["graphic_violence"],
      povCharacter: "Rook",
      chapterCount: 12,
      research: false,
      reviewOutline: true,
    });
    // A canon setting has no notes box in the form, so no hidden notes go in.
    expect(request.settingNotes).toBe("");
    // Only the requester can confirm that everyone is an adult.
    expect(request.adultsConfirmed).toBe(false);
    expect(request.prompt).toContain("the city falls");
  });

  it("asks once more when the reply isn't a request", async () => {
    const { storage } = setup();
    const { llm, requests } = llmReplying("Sure! Here's a summary.", JSON.stringify(draft));
    await startFanficFromChat({ storage, llm }, { chatId: "rp" });
    expect(requests).toHaveLength(2);
  });

  it("keeps the newest messages when a long chat doesn't fit, and says how many were left out", async () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      id: String(index),
      chatId: "rp",
      role: index % 2 ? "user" : "assistant",
      characterId: "vex",
      content: `Line ${index} ${"x".repeat(400)}`,
      createdAt: `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
    }));
    const { storage } = setup({ messages, maxContext: 12_000 });
    const { llm, requests } = llmReplying(JSON.stringify(draft));
    await startFanficFromChat({ storage, llm }, { chatId: "rp" });
    const prompt = requests[0]!.messages[1]!.content;
    expect(prompt).toContain("Line 59");
    expect(prompt).not.toContain("Line 0 ");
    expect(prompt).toMatch(/the first \d+ messages are left out/);
  });

  it("refuses a fic, and a chat with nothing in it yet", async () => {
    const fic = setup({ mode: "fanfic" });
    await expect(
      startFanficFromChat({ storage: fic.storage, llm: llmReplying("{}").llm }, { chatId: "rp" }),
    ).rejects.toThrow("Only chats and roleplays can be turned into a fic.");
    const empty = setup({ messages: [] });
    await expect(
      startFanficFromChat({ storage: empty.storage, llm: llmReplying("{}").llm }, { chatId: "rp" }),
    ).rejects.toThrow("There's nothing in this chat to turn into a fic yet.");
  });

  it("is no draft for an ordinary fic", () => {
    expect(readFanficDraftRequest({ fanfic: {} })).toBeNull();
    expect(readFanficSource({})).toBeNull();
  });

  it("ends the draft once the request is saved", async () => {
    const patches: Record<string, unknown>[] = [];
    const storage = {
      async get() {
        return { id: "fic", mode: "fanfic", connectionId: null, characterIds: [] };
      },
      async update() {},
      async patchChatMetadata(_id: string, patch: Record<string, unknown>) {
        patches.push(patch);
      },
    } as unknown as StorageGateway;
    await saveFanficRequest(storage, {
      chatId: "fic",
      request: defaultFanficRequest(),
      connectionId: "c",
      characterIds: [],
    });
    expect(patches[0]).toMatchObject({ fanficDraftRequest: null });
    expect(readFanficDraftRequest(patches[0])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import { createFanficState, defaultFanficRequest } from "./request";
import { readFanficLink, readFanficLinkedChatIds } from "./links";
import { fanficCastNames, startChatFromFanfic, type StartChatFromFanficInput } from "./to-chat";

const request = {
  ...defaultFanficRequest(),
  fandom: "The Freak Circus",
  characters: ["Harlequin", "Pierrot"],
  chapterCount: 2,
};
const outline = {
  title: "Collection",
  summary: "",
  chapters: [
    { number: 1, title: "Terms", summary: "They set a safe word." },
    { number: 2, title: "After", summary: "Pierrot leaves." },
  ],
};
const state: FanficState = { ...createFanficState(request), outline, outlineApproved: true };

function setup(options: { chapters?: number } = {}) {
  const chats = new Map<string, Record<string, unknown>>([
    [
      "fic",
      {
        id: "fic",
        name: "My fic",
        mode: "fanfic",
        connectionId: "conn",
        characterIds: ["harl"],
        personaId: null,
        metadata: { fanfic: state, activeLorebookIds: ["circus"] },
      },
    ],
  ]);
  const chapters = [
    { id: "m1", chatId: "fic", role: "assistant", content: "They set the word: bells." },
    { id: "m2", chatId: "fic", role: "assistant", content: "Pierrot walked out at dawn." },
  ].slice(0, options.chapters ?? 2);
  const created: Array<{ entity: string; value: Record<string, unknown> }> = [];
  const messages: Record<string, unknown>[] = [];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections" && id === "conn") return { id, provider: "openai" } as T;
      if (entity === "characters" && id === "harl") {
        return { id, data: { name: "Harlequin", description: "A clown with a knife." } } as T;
      }
      return null;
    },
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "personas") return [{ id: "me", name: "Chai", description: "A visitor.", isActive: true }] as T[];
      return [];
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return chapters.filter((message) => message.chatId === chatId) as T[];
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `${entity}-${created.length + 1}`, ...value };
      created.push({ entity, value: row });
      if (entity === "chats") chats.set(row.id, row);
      return row as T;
    },
    async patchChatMetadata(id: string, patch: Record<string, unknown>) {
      const row = chats.get(id);
      if (row) chats.set(id, { ...row, metadata: { ...(row.metadata as Record<string, unknown>), ...patch } });
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      messages.push({ chatId, ...value });
      return value as T;
    },
  } as unknown as StorageGateway;
  return { storage, created, messages, chats };
}

function llmReplying(...replies: unknown[]) {
  const requests: LlmRequest[] = [];
  const llm = {
    async complete(request: LlmRequest) {
      requests.push(request);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      return typeof reply === "string" ? reply : JSON.stringify(reply);
    },
  } as unknown as LlmGateway;
  return { llm, requests };
}

const setupReply = {
  storySoFar: "They agreed on bells. Pierrot left at dawn.",
  cards: [{ name: "Pierrot", description: "A sad mime who left the circus.", personality: "Quiet, proud." }],
  persona: null,
  opening: "The tent is cold without him.",
};
const roleplay: Omit<StartChatFromFanficInput, "ficChatId"> = {
  mode: "roleplay",
  cast: ["Harlequin", "Pierrot"],
  playAs: { kind: "persona" },
};

describe("continuing a fic as a chat", () => {
  it("sets up a roleplay after the last chapter: a card for the uncarded character, the recap as its summary", async () => {
    const { storage, created, messages, chats } = setup();
    const { llm, requests } = llmReplying(setupReply);
    const chat = await startChatFromFanfic({ storage, llm }, { ficChatId: "fic", ...roleplay });

    const [system, user] = requests[0]!.messages;
    expect(requests[0]!.connectionId).toBe("conn");
    expect(system!.content).toContain(
      "The requester who asked for the fic will play Chai; the AI will play Harlequin, Pierrot.",
    );
    expect(system!.content).toContain("Chai is the requester's own character and isn't in the fic: A visitor.");
    expect(system!.content).toContain("a character card for each of Pierrot, who have no card yet");
    expect(system!.content).toContain("never write Chai's actions");
    expect(user!.content).toContain("Pierrot walked out at dawn.");

    const card = created.find((row) => row.entity === "characters")!.value;
    expect(card).toMatchObject({
      name: "Pierrot",
      data: { name: "Pierrot", description: "A sad mime who left the circus." },
    });
    expect(created.some((row) => row.entity === "personas")).toBe(false);
    expect(chat).toMatchObject({
      name: "Collection (roleplay)",
      mode: "roleplay",
      characterIds: ["harl", card.id],
      personaId: "me",
      connectionId: "conn",
    });
    const metadata = chat.metadata as Record<string, unknown>;
    expect(metadata.activeLorebookIds).toEqual(["circus"]);
    expect(metadata.summary).toBe("They agreed on bells. Pierrot left at dawn.");
    expect(metadata.summaryEntries).toEqual([
      expect.objectContaining({ title: "The story so far: Collection", enabled: true, origin: "manual" }),
    ]);
    expect(metadata.fanficOrigin).toEqual({ version: 1, ficChatId: "fic", title: "Collection" });
    expect(readFanficLinkedChatIds(chats.get("fic")!.metadata)).toEqual([String(chat.id)]);
    expect(readFanficLink(chats.get(String(chat.id))!.metadata)).toBe("fic");
    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", characterId: "harl", content: "The tent is cold without him." }),
    ]);
  });

  it("makes a persona for a fic character the requester plays, and texts them as one character", async () => {
    const { storage, created } = setup();
    const { llm, requests } = llmReplying({
      ...setupReply,
      cards: [],
      persona: { name: "Pierrot", description: "A sad mime, back in town." },
    });
    const chat = await startChatFromFanfic(
      { storage, llm },
      { ficChatId: "fic", mode: "conversation", cast: ["Harlequin"], playAs: { kind: "character", name: "Pierrot" } },
    );
    const system = requests[0]!.messages[0]!.content;
    expect(system).toContain("Pierrot is a character in the fic.");
    expect(system).toContain("the requester's persona for Pierrot");
    expect(system).toContain("Harlequin's first text to Pierrot");
    expect(created.filter((row) => row.entity === "characters")).toHaveLength(0);
    const persona = created.find((row) => row.entity === "personas")!.value;
    expect(persona).toMatchObject({ name: "Pierrot", description: "A sad mime, back in town." });
    expect(chat).toMatchObject({ mode: "conversation", characterIds: ["harl"], personaId: persona.id });
  });

  it("asks again when a card is missing, and saves nothing when the setup never comes", async () => {
    const { storage, created } = setup();
    const { llm, requests } = llmReplying({ ...setupReply, cards: [] });
    await expect(startChatFromFanfic({ storage, llm }, { ficChatId: "fic", ...roleplay })).rejects.toThrow(
      "no card for Pierrot",
    );
    expect(requests).toHaveLength(2);
    expect(created).toHaveLength(0);
  });

  it("refuses a chat with several characters, playing a character the AI plays, and a fic with no chapters", async () => {
    const { storage } = setup();
    const { llm } = llmReplying(setupReply);
    await expect(
      startChatFromFanfic({ storage, llm }, { ficChatId: "fic", ...roleplay, mode: "conversation" }),
    ).rejects.toThrow("A chat is with one character.");
    await expect(
      startChatFromFanfic(
        { storage, llm },
        { ficChatId: "fic", ...roleplay, playAs: { kind: "character", name: "harlequin" } },
      ),
    ).rejects.toThrow("You can't play a character the AI is playing too.");
    const empty = setup({ chapters: 0 });
    await expect(
      startChatFromFanfic({ storage: empty.storage, llm }, { ficChatId: "fic", ...roleplay }),
    ).rejects.toThrow("Write a chapter first");
  });

  it("lists the fic's cast: the request's characters, then linked cards it doesn't name", () => {
    expect(fanficCastNames(state, ["harlequin", "Ringmaster"])).toEqual(["Harlequin", "Pierrot", "Ringmaster"]);
  });
});

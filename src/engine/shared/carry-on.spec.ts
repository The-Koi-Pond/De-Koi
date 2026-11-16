import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { canLinkCarriedChat, carryChatOn, carryOnTarget } from "./carry-on";
import { normalizeChatSummaryMetadata } from "./text/chat-summary-entries";
import { fitTranscript, tranceSessionLines } from "./text/chat-transcript";

const tranceMetadata = {
  trance: {
    version: 1,
    request: {
      moods: ["tired"],
      moodNote: "long shift",
      idea: "the lighthouse lamp",
      pitch: { title: "Lamp Watch", summary: "Breathe with the lens.", sample: [] },
    },
    script: {
      lines: [
        { phase: "pretalk", text: "Sit, little moth." },
        { phase: "pretalk", text: "The lamp does the work tonight." },
        { phase: "induction", text: "In while it sweeps the water." },
        { phase: "wake", text: "Three, two, one. Awake." },
      ],
    },
    runs: [{ finishedBy: "completed", rating: 8, fullyAwake: true, note: "the stairs bit helped" }],
  },
};

const setupReply = (opening: string) =>
  JSON.stringify({ storySoFar: "Rook washed up at the lighthouse and Vex took them in.", opening });

function setup(
  options: { mode?: string; messages?: Record<string, unknown>[]; metadata?: Record<string, unknown> } = {},
) {
  const chats = new Map<string, Record<string, unknown>>([
    [
      "src",
      {
        id: "src",
        name: "Gull Rock",
        mode: options.mode ?? "roleplay",
        characterIds: ["vex", "pip"],
        personaId: "me",
        connectionId: "src-conn",
        metadata: options.metadata ?? { summary: "Earlier, Rook stole a map.", activeLorebookIds: ["coast"] },
      },
    ],
  ]);
  const messages = options.messages ?? [
    {
      id: "1",
      chatId: "src",
      role: "assistant",
      characterId: "vex",
      content: "Up you get, little moth.",
      createdAt: "1",
    },
    { id: "2", chatId: "src", role: "user", content: "Don't call me that.", createdAt: "2" },
  ];
  const created: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  const cards: Record<string, string> = { vex: "Vex", pip: "Pip" };
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections" && id === "src-conn") return { id, provider: "openai" } as T;
      if (entity === "characters" && cards[id]) return { id, data: { name: cards[id], description: "Kind." } } as T;
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
      const row = { id: `new-${created.length + 1}`, ...value };
      created.push(row);
      return row as T;
    },
    async createChatMessage(_chatId: string, value: Record<string, unknown>) {
      sent.push(value);
      return value;
    },
  } as unknown as StorageGateway;
  return { storage, created, sent };
}

function llmReplying(...replies: string[]) {
  const requests: LlmRequest[] = [];
  const llm = {
    async complete(request: LlmRequest) {
      requests.push(request);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
      if (reply === "fail") throw new Error("provider down");
      return reply;
    },
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("carrying a chat on in the other mode", () => {
  it("carries a roleplay on as texts with one of its characters, with the story so far as a summary", async () => {
    const { storage, created, sent } = setup();
    const { llm, requests } = llmReplying(setupReply("still counting stairs?\n\nthe lamp's lit"));
    const chat = await carryChatOn({ storage, llm }, { chatId: "src", characterId: "pip" });

    expect(requests[0]!.connectionId).toBe("src-conn");
    const prompt = requests[0]!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain('carrying the roleplay "Gull Rock" on as a texting chat');
    expect(prompt).toContain("Pip's first text to Rook");
    expect(prompt).toContain("Earlier, Rook stole a map.");
    expect(prompt).toContain("Vex: Up you get, little moth.\n\nRook: Don't call me that.");

    expect(created).toHaveLength(1);
    expect(chat).toMatchObject({
      name: "Gull Rock (chat)",
      mode: "conversation",
      characterIds: ["pip"],
      personaId: "me",
      connectionId: "src-conn",
      connectedChatId: null,
    });
    const metadata = chat.metadata as Record<string, unknown>;
    expect(metadata.activeLorebookIds).toEqual(["coast"]);
    expect(normalizeChatSummaryMetadata(metadata).entries[0]).toMatchObject({
      title: "The story so far: Gull Rock",
      content: "Rook washed up at the lighthouse and Vex took them in.",
    });
    expect(sent).toEqual([
      expect.objectContaining({
        role: "assistant",
        characterId: "pip",
        content: "still counting stairs?\n\nthe lamp's lit",
      }),
    ]);
  });

  it("texts with the first character when none is picked", async () => {
    const { storage } = setup();
    const { llm } = llmReplying(setupReply("hey"));
    expect(await carryChatOn({ storage, llm }, { chatId: "src" })).toMatchObject({ characterIds: ["vex"] });
  });

  it("carries a chat on as a roleplay with all of its characters", async () => {
    const { storage, sent } = setup({ mode: "conversation" });
    const { llm, requests } = llmReplying(setupReply("The ferry docks at dawn."));
    const chat = await carryChatOn({ storage, llm }, { chatId: "src", characterId: "pip" });

    expect(requests[0]!.messages[0]!.content).toContain("never write Rook's actions, words or thoughts");
    expect(chat).toMatchObject({ name: "Gull Rock (roleplay)", mode: "roleplay", characterIds: ["vex", "pip"] });
    expect(sent[0]).toMatchObject({ characterId: "vex", content: "The ferry docks at dawn." });
  });

  it("asks again once when the reply can't be read, and saves nothing when the model fails", async () => {
    const retried = setup();
    const { llm, requests } = llmReplying("no json here", setupReply("hey"));
    await carryChatOn({ storage: retried.storage, llm }, { chatId: "src" });
    expect(requests).toHaveLength(2);
    expect(retried.created).toHaveLength(1);

    const failed = setup();
    await expect(
      carryChatOn({ storage: failed.storage, llm: llmReplying("fail").llm }, { chatId: "src" }),
    ).rejects.toThrow("provider down");
    const unreadable = setup();
    await expect(
      carryChatOn({ storage: unreadable.storage, llm: llmReplying("still no json").llm }, { chatId: "src" }),
    ).rejects.toThrow("missing the recap");
    expect([...failed.created, ...failed.sent, ...unreadable.created, ...unreadable.sent]).toEqual([]);
  });

  it("refuses an empty chat and modes it doesn't cover", async () => {
    const { llm } = llmReplying(setupReply("hey"));
    await expect(carryChatOn({ storage: setup({ messages: [] }).storage, llm }, { chatId: "src" })).rejects.toThrow(
      "nothing in this chat",
    );
    await expect(carryChatOn({ storage: setup({ mode: "fanfic" }).storage, llm }, { chatId: "src" })).rejects.toThrow(
      "Only chats, roleplays and trance sessions",
    );
  });

  it("reads a trance session as its parts in the guide's voice, with how the listener felt before and after", () => {
    const lines = tranceSessionLines(tranceMetadata, { guide: "Vex", listener: "Rook" });
    expect(fitTranscript(lines, 10_000).text).toBe(
      [
        "The session: Lamp Watch: Breathe with the lens.",
        "Rook: (Before the session, how I feel) tired. long shift",
        "Vex (pretalk): Sit, little moth. The lamp does the work tonight.",
        "Vex (induction): In while it sweeps the water.",
        "Vex (wake): Three, two, one. Awake.",
        "Rook: (After the session) I finished the session; felt 8/10; said: the stairs bit helped.",
      ].join("\n\n"),
    );
    // Nothing to read until a script is written.
    expect(
      tranceSessionLines({ trance: { request: {}, script: null, runs: [] } }, { guide: "Vex", listener: "Rook" }),
    ).toEqual([]);
  });

  it("talks a trance session over with its guide, in texts", async () => {
    const { storage, created, sent } = setup({ mode: "trance", messages: [], metadata: tranceMetadata });
    const { llm, requests } = llmReplying(setupReply("how are you feeling, moth?"));
    const chat = await carryChatOn({ storage, llm }, { chatId: "src" });

    const [system, user] = requests[0]!.messages;
    expect(system!.content).toContain('Vex guided Rook through the hypnosis session "Gull Rock"');
    expect(system!.content).toContain("so they can talk it over");
    expect(system!.content).toContain("no new hypnosis");
    expect(user!.content).toContain("## The hypnosis session, in order");
    expect(user!.content).toContain("Vex (induction): In while it sweeps the water.");
    expect(user!.content).toContain("said: the stairs bit helped");

    expect(chat).toMatchObject({ name: "Gull Rock (chat)", mode: "conversation", characterIds: ["vex"] });
    expect(normalizeChatSummaryMetadata(chat.metadata as Record<string, unknown>).entries[0]).toMatchObject({
      title: "The session: Gull Rock",
    });
    expect(sent[0]).toMatchObject({ characterId: "vex", content: "how are you feeling, moth?" });
    expect(created).toHaveLength(1);

    const unwritten = setup({ mode: "trance", messages: [], metadata: { trance: { script: null } } });
    await expect(carryChatOn({ storage: unwritten.storage, llm }, { chatId: "src" })).rejects.toThrow(
      "This session hasn't been written yet",
    );
  });

  it("knows which modes carry on as which, and when the two can be linked", () => {
    expect(carryOnTarget("roleplay")).toBe("conversation");
    expect(carryOnTarget("visual_novel")).toBe("conversation");
    expect(carryOnTarget("conversation")).toBe("roleplay");
    expect(carryOnTarget("trance")).toBe("conversation");
    expect(carryOnTarget("fanfic")).toBeNull();
    expect(canLinkCarriedChat("roleplay", false)).toBe(true);
    expect(canLinkCarriedChat("roleplay", true)).toBe(false);
    expect(canLinkCarriedChat("visual_novel", false)).toBe(false);
    expect(canLinkCarriedChat("trance", false)).toBe(false);
  });
});

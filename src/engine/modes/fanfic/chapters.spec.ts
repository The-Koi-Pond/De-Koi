import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../../capabilities/integrations";
import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import type { GenerationEvent } from "../../generation/generation-events";
import { startFanficGeneration } from "./chapters";
import { fanficChapterTextKey } from "./ledger";
import { FanficOutlineCountError, generateFanficOutline } from "./outline";
import { defaultFanficRequest, normalizeFanficRequest } from "./request";
import { saveFanficRequest } from "./request-save";

type StoredMessage = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  activeSwipeIndex: number;
  swipeCount: number;
  extra: Record<string, unknown>;
  swipes: Array<{ content: string; extra?: Record<string, unknown> }>;
};

const approvedState: FanficState = {
  version: 1,
  request: normalizeFanficRequest({
    ...defaultFanficRequest(),
    fandom: "Good Omens",
    relationships: ["Aziraphale/Crowley"],
    prompt: "Snowed in at the bookshop.",
    chapterCount: 2,
    wordsPerChapter: 1500,
  }),
  outline: {
    title: "Snow Day",
    summary: "Neither of them will admit it's on purpose.",
    chapters: [
      { number: 1, title: "First Flakes", summary: "Crowley arrives as the snow starts." },
      { number: 2, title: "Thaw", summary: "They finally talk." },
    ],
  },
  outlineApproved: true,
  research: null,
};

function fanficStorage(fanfic: FanficState | null = approvedState) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "fanfic",
      connectionId: "conn-1",
      characterIds: ["char-crowley"],
      metadata: { fanfic, enableAgents: true, activeAgentIds: ["world-state"] },
    },
    "conn-1": { id: "conn-1", provider: "test-provider", model: "test-model" },
    "char-crowley": {
      id: "char-crowley",
      name: "Crowley",
      data: { name: "Crowley", description: "A demon who {{char}} insists is not nice.", first_mes: "Hello {{user}}." },
    },
    "persona-1": { id: "persona-1", name: "Reader Persona", isActive: true, description: "Should never appear." },
    "preset-default": { id: "preset-default", name: "RP preset" },
  };
  const messages: StoredMessage[] = [];
  let nextMessageId = 1;
  const created = (chatId: string, value: Record<string, unknown>): StoredMessage => {
    const content = String(value.content ?? "");
    const extra = (value.extra as Record<string, unknown> | undefined) ?? {};
    const message: StoredMessage = {
      id: `message-${nextMessageId++}`,
      chatId,
      role: String(value.role ?? ""),
      content,
      characterId: typeof value.characterId === "string" ? value.characterId : null,
      activeSwipeIndex: 0,
      swipeCount: 1,
      extra: { ...extra },
      swipes: [{ content, extra: { ...extra } }],
    };
    messages.push(message);
    return message;
  };

  const storage: StorageGateway = {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "connections") return [records["conn-1"]] as T[];
      if (entity === "personas") return [records["persona-1"]] as T[];
      return [] as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      return (
        (entity === "chats" || entity === "connections" || entity === "characters" || entity === "personas") &&
        records[id]
          ? records[id]
          : null
      ) as T | null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return { id: "created", ...value } as T;
    },
    async update<T = unknown>(_entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      records[id] = { ...(records[id] ?? { id }), ...patch };
      return records[id] as T;
    },
    async delete(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async getChatMessage<T = unknown>(messageId: string): Promise<T | null> {
      return (messages.find((message) => message.id === messageId) ?? null) as T | null;
    },
    async createChatMessage<T = unknown>(chatId: string, value: Record<string, unknown>): Promise<T> {
      return created(chatId, value) as T;
    },
    async updateChatMessage<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      Object.assign(message, patch);
      return message as T;
    },
    async deleteChatMessage(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...message.extra, ...patch };
      return message as T;
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
    async patchChatSummaries<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], ...patch };
      return records[chatId] as T;
    },
    async listChatMemories<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async getWorldState<T = unknown>(): Promise<T | null> {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>(): Promise<T> {
      return {} as T;
    },
    async listLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>(): Promise<T[]> {
      return [] as T[];
    },
    async addChatMessageSwipe<T = unknown>(
      _chatId: string,
      messageId: string,
      content: string,
      options?: { extra?: Record<string, unknown> },
    ): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.swipes.push({ content, extra: options?.extra ?? {} });
      message.swipeCount = message.swipes.length;
      message.activeSwipeIndex = message.swipes.length - 1;
      message.content = content;
      return message as T;
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
  } as StorageGateway;

  return { storage, messages, records };
}

function proseLlm(responses: string[], completeResponse = ""): LlmGateway & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let index = 0;
  return {
    requests,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return completeResponse;
    }),
    async *stream(request) {
      requests.push(request);
      yield { type: "token", text: responses[index++] ?? "" };
    },
    listModels: vi.fn(async () => []),
  };
}

async function drain(generator: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function promptText(request: LlmRequest | undefined): string {
  return (request?.messages ?? []).map((message) => `[${message.role}] ${message.content}`).join("\n");
}

describe("startFanficGeneration", () => {
  it("writes chapter 1 from the outline without saving a request message or running agents", async () => {
    const { storage, messages } = fanficStorage();
    const llm = proseLlm(["Snow fell on Soho."]);

    await drain(
      startFanficGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );

    expect(messages.map((message) => [message.role, message.content])).toEqual([["assistant", "Snow fell on Soho."]]);
    expect(llm.requests).toHaveLength(1);
    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("You are writing a requested");
    expect(prompt).toContain("These habits make prose read as machine-written");
    expect(prompt).toContain("Relationships: Aziraphale/Crowley");
    expect(prompt).toContain("### Crowley\nDescription: A demon who Crowley insists is not nice.");
    expect(prompt).not.toContain("Reader Persona");
    expect(prompt).not.toContain("Hello another character.");
    const last = llm.requests[0]!.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("Write chapter 1 now, about 1500 words.");
    expect(last.content).toContain("Chapter 1: First Flakes");
    expect(Number(llm.requests[0]!.parameters?.maxTokens)).toBeGreaterThanOrEqual(5000);
    expect(messages[0]!.extra.generationReplay).toMatchObject({ generationGuideSource: "fanfic_chapter" });
  });

  it("shows earlier chapters with headings and asks for the next one", async () => {
    const { storage, messages } = fanficStorage();
    const llm = proseLlm(["Snow fell on Soho.", "They finally talked."]);
    const deps = { storage, llm, integrations: {} as IntegrationGateway };

    await drain(startFanficGeneration(deps, { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" }));
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "chapter",
        notes: "Let Aziraphale win the argument.",
      }),
    );

    expect(messages.map((message) => message.content)).toEqual(["Snow fell on Soho.", "They finally talked."]);
    const prompt = promptText(llm.requests[1]);
    expect(prompt).toContain(
      "[user] Write chapter 1: First Flakes.\n[assistant] Snow fell on Soho.\n[user] Write chapter 2 now",
    );
    expect(prompt).toContain("Write chapter 2 now");
    expect(prompt).toContain("final planned chapter");
    expect(prompt).toContain("Let Aziraphale win the argument.");
  });

  it("tells the next chapter which pet names earlier chapters wore out, but not a redo of the same chapter", async () => {
    const { storage, messages } = fanficStorage();
    const angel = Array.from(
      { length: 6 },
      (_, index) => `"Angel, look." Crowley points at the snow. "Angel, it's ${index} inches."`,
    ).join("\n\n");
    const llm = proseLlm([angel, "They finally talked.", "Snow, again."]);
    const deps = { storage, llm, integrations: {} as IntegrationGateway };

    await drain(startFanficGeneration(deps, { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" }));
    await drain(startFanficGeneration(deps, { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" }));
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "regenerate",
        regenerateMessageId: messages[0]!.id,
      }),
    );

    const nextChapter = promptText(llm.requests[1]);
    expect(nextChapter).toContain('Calling someone "Angel" (12 times so far): once or twice at most in this chapter.');
    expect(nextChapter).not.toContain('Calling someone "Crowley"');
    expect(promptText(llm.requests[2])).not.toContain('Calling someone "Angel"');
  });

  it("rewrites a chapter with notes as a new version of the same message", async () => {
    const { storage, messages } = fanficStorage();
    const llm = proseLlm(["Draft one.", "Draft two, snarkier."]);
    const deps = { storage, llm, integrations: {} as IntegrationGateway };

    await drain(startFanficGeneration(deps, { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" }));
    const chapterId = messages[0]!.id;
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "revise",
        regenerateMessageId: chapterId,
        notes: "Make Crowley snarkier.",
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.swipes.map((swipe) => swipe.content)).toEqual(["Draft one.", "Draft two, snarkier."]);
    const prompt = promptText(llm.requests[1]);
    expect(prompt).toContain("Rewrite chapter 1");
    expect(prompt).toContain('Previous draft:\n"""\nDraft one.\n"""');
    expect(prompt).toContain("Make Crowley snarkier.");
    expect(prompt).not.toContain("[assistant] Draft one.");
  });

  it("keeps the story ledger when a small window drops the oldest chapter's prose", async () => {
    const { storage, messages, records } = fanficStorage();
    const prose = (n: number) => `Chapter ${n} marker. ${"The snow kept falling on Soho. ".repeat(260)}`;
    for (const n of [1, 2, 3]) await storage.createChatMessage("chat-1", { role: "assistant", content: prose(n) });
    const entry = (n: number) => ({
      chapter: n,
      messageId: messages[n - 1]!.id,
      textKey: fanficChapterTextKey(prose(n)),
      summary: `Ledger summary of chapter ${n}.`,
      timeline: `Night ${n}`,
      knowledge: [{ subject: "The bookshop key", detail: "Only Crowley knows it's under the mat." }],
      conditions: [],
      relationships: [],
      openThreads: [],
    });
    records["conn-1"] = { ...records["conn-1"], maxContext: 11_500 };
    const write = async () => {
      const llm = proseLlm(["Chapter four."]);
      await drain(
        startFanficGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
        ),
      );
      messages.pop();
      return promptText(llm.requests[0]);
    };

    const without = await write();
    expect(without).not.toContain("Chapter 1 marker.");
    expect(without).not.toContain("Story ledger");

    const metadata = records["chat-1"]!.metadata as Record<string, unknown>;
    metadata.fanficLedger = { version: 1, entries: [entry(1), entry(2), entry(3)] };
    const withLedger = await write();
    expect(withLedger).not.toContain("Chapter 1 marker.");
    expect(withLedger).toContain("Chapter 3 marker.");
    expect(withLedger).toContain("## Story ledger");
    expect(withLedger).toContain("### Where things stand after chapter 3");
    expect(withLedger).toContain("- The bookshop key: Only Crowley knows it's under the mat.");
    expect(withLedger).toContain("Chapter 1: Ledger summary of chapter 1.");
  });

  it("refuses to write before the outline is approved", async () => {
    const { storage } = fanficStorage({ ...approvedState, outlineApproved: false });
    const llm = proseLlm(["never"]);
    await expect(
      drain(
        startFanficGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
        ),
      ),
    ).rejects.toThrow("Finish the fanfic request and outline before writing chapters.");
    expect(llm.requests).toHaveLength(0);
  });
});

describe("generateFanficOutline", () => {
  it("stores the outline and leaves it for review when the requester asked to see it", async () => {
    const { storage, records } = fanficStorage({ ...approvedState, outline: null, outlineApproved: false });
    const llm = proseLlm(
      [],
      JSON.stringify({
        title: "Snow Day",
        summary: "S",
        chapters: [
          { title: "A", summary: "a" },
          { title: "B", summary: "b" },
        ],
      }),
    );

    const state = await generateFanficOutline({ storage, llm }, { chatId: "chat-1" });

    expect(state.outline?.chapters.map((chapter) => chapter.title)).toEqual(["A", "B"]);
    expect(state.outlineApproved).toBe(false);
    expect((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic.outline?.title).toBe("Snow Day");
    expect(llm.requests[0]!.connectionId).toBe("conn-1");
    expect(promptText(llm.requests[0])).toContain("Outline this fic in exactly 2 chapters.");
  });

  it("approves the outline right away when review was skipped", async () => {
    const { storage } = fanficStorage({
      ...approvedState,
      request: { ...approvedState.request, reviewOutline: false },
      outline: null,
      outlineApproved: false,
    });
    const llm = proseLlm(
      [],
      '{"title":"T","summary":"S","chapters":[{"title":"A","summary":"a"},{"title":"B","summary":"b"}]}',
    );
    const state = await generateFanficOutline({ storage, llm }, { chatId: "chat-1" });
    expect(state.outlineApproved).toBe(true);
  });

  it.each([
    ["fewer", [{ title: "A", summary: "a" }], "1 chapter instead of 2"],
    [
      "more",
      [
        { title: "A", summary: "a" },
        { title: "B", summary: "b" },
        { title: "C", summary: "c" },
      ],
      "3 chapters instead of 2",
    ],
  ])("stores nothing when the plan has %s chapters than requested", async (_label, chapters, message) => {
    const pending = { ...approvedState, outline: null, outlineApproved: false };
    const { storage, records } = fanficStorage(pending);
    const llm = proseLlm([], JSON.stringify({ title: "T", summary: "S", chapters }));

    await expect(generateFanficOutline({ storage, llm }, { chatId: "chat-1" })).rejects.toThrow(
      FanficOutlineCountError,
    );
    await expect(generateFanficOutline({ storage, llm }, { chatId: "chat-1" })).rejects.toThrow(message);
    expect((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic).toEqual(pending);
  });
});

describe("saveFanficRequest", () => {
  const request = normalizeFanficRequest({ ...defaultFanficRequest(), fandom: "Hades", prompt: "A quiet night." });

  it("saves the connection, linked cards, and a fresh request together", async () => {
    const { storage, records } = fanficStorage();
    const state = await saveFanficRequest(storage, {
      chatId: "chat-1",
      request,
      connectionId: "conn-2",
      characterIds: ["char-zag"],
    });
    expect(state).toMatchObject({ outline: null, outlineApproved: false });
    expect(records["chat-1"]).toMatchObject({ connectionId: "conn-2", characterIds: ["char-zag"] });
    expect((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic.request.fandom).toBe("Hades");
  });

  it("puts the previous connection and cards back when the request write fails", async () => {
    const { storage, records } = fanficStorage();
    storage.patchChatMetadata = async () => {
      throw new Error("disk full");
    };
    await expect(
      saveFanficRequest(storage, { chatId: "chat-1", request, connectionId: "conn-2", characterIds: ["char-zag"] }),
    ).rejects.toThrow("The request could not be saved (disk full). Nothing was changed; try again.");
    expect(records["chat-1"]).toMatchObject({ connectionId: "conn-1", characterIds: ["char-crowley"] });
    expect((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic).toEqual(approvedState);
  });

  it("says so when the rollback fails too", async () => {
    const { storage } = fanficStorage();
    const update = storage.update.bind(storage);
    let updates = 0;
    storage.update = async (entity, id, patch) => {
      updates += 1;
      if (updates > 1) throw new Error("offline");
      return update(entity, id, patch);
    };
    storage.patchChatMetadata = async () => {
      throw new Error("disk full");
    };
    await expect(
      saveFanficRequest(storage, { chatId: "chat-1", request, connectionId: "conn-2", characterIds: [] }),
    ).rejects.toThrow("could not be restored");
  });
});

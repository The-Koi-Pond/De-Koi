import { describe, expect, it, vi } from "vitest";

import type { IntegrationGateway } from "../../capabilities/integrations";
import type { LlmChunk, LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState, FanficVersion } from "../../contracts/types/fanfic";
import type { GenerationEvent } from "../../generation/generation-events";
import {
  keepFanficVersion,
  settleFanficWrite,
  startFanficGeneration,
  type StartFanficGenerationInput,
} from "./chapters";
import { applyFanficContinuityFixesToChapter } from "./continuity";
import { rewriteFanficFlaggedScenes, type FanficEditorReport } from "./editor";
import { fanficChapterTextKey } from "./ledger";
import { removeFanficBannedPhrasesFrom, suggestFanficPassageRewrite } from "./passage";
import { FanficOutlineCountError, generateFanficOutline } from "./outline";
import { defaultFanficRequest, normalizeFanficRequest } from "./request";
import { saveFanficRequest } from "./request-save";
import { fanficModelLabel, readFanficVersion } from "./versions";

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
  const lorebooks: Array<Record<string, unknown>> = [];
  const loreEntries: Array<Record<string, unknown>> = [];
  const deletedSwipes: Array<{ messageId: string; index: number }> = [];
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
      if (entity === "lorebooks") return lorebooks as T[];
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
      // The runtime writes a patch into the displayed version too.
      const active = message.swipes[message.activeSwipeIndex];
      if (active && typeof patch.content === "string") active.content = patch.content;
      if (active && patch.extra) active.extra = { ...active.extra, ...(patch.extra as Record<string, unknown>) };
      return message as T;
    },
    async deleteChatMessage(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Missing message ${messageId}`);
      message.extra = { ...message.extra, ...patch };
      // The runtime writes a swipe-scoped key into the displayed version too.
      const active = message.swipes[message.activeSwipeIndex];
      if (active && "fanficVersion" in patch) active.extra = { ...active.extra, fanficVersion: patch.fanficVersion };
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
    async listLorebookEntries<T = unknown>(lorebookId: string): Promise<T[]> {
      return loreEntries.filter((entry) => entry.lorebookId === lorebookId) as T[];
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
    async deleteChatMessageSwipe<T = unknown>(_chatId: string, messageId: string, index: number): Promise<T> {
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.swipes.length <= 1 || index >= message.swipes.length) throw new Error("Swipe not found");
      // The runtime's rule: a later displayed version moves down one; the shown one is what is left there.
      message.swipes.splice(index, 1);
      if (message.activeSwipeIndex > index) message.activeSwipeIndex -= 1;
      message.activeSwipeIndex = Math.min(message.activeSwipeIndex, message.swipes.length - 1);
      message.swipeCount = message.swipes.length;
      const shown = message.swipes[message.activeSwipeIndex]!;
      message.content = shown.content;
      message.extra = { ...message.extra, fanficVersion: shown.extra?.fanficVersion };
      deletedSwipes.push({ messageId, index });
      return message as T;
    },
    async promptFull<T = unknown>(): Promise<T | null> {
      return null;
    },
  } as StorageGateway;

  return { storage, messages, records, lorebooks, loreEntries, deletedSwipes };
}

/**
 * A picked lorebook whose "bookshop" entry matches only the request text, an entry nothing mentions, and an
 * unpicked lorebook that would also match.
 */
function addLore({ records, lorebooks, loreEntries }: ReturnType<typeof fanficStorage>) {
  const chat = records["chat-1"]!;
  chat.metadata = { ...(chat.metadata as object), activeLorebookIds: ["lb-omens"] };
  lorebooks.push({ id: "lb-omens", name: "Good Omens World", enabled: true });
  lorebooks.push({ id: "lb-spare", name: "Discworld Notes", enabled: true });
  const entry = (id: string, lorebookId: string, keys: string[], content: string) => ({
    id,
    lorebookId,
    name: id,
    keys,
    content,
    enabled: true,
    constant: false,
    position: 0,
  });
  loreEntries.push(
    entry("e-shop", "lb-omens", ["bookshop"], "LORE-SHOP: The bookshop is A.Z. Fell & Co. in Soho."),
    entry("e-tadfield", "lb-omens", ["Tadfield"], "LORE-TADFIELD: Tadfield is in Oxfordshire."),
    entry("e-ankh", "lb-spare", ["bookshop"], "LORE-ANKH: Ankh-Morpork has no bookshops."),
  );
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

/** A stream that sends the given chunks, then throws `failure` if one is given. */
function streamLlm(chunks: LlmChunk[], failure?: unknown, onChunk?: (index: number) => void): LlmGateway {
  return {
    complete: vi.fn(async () => ""),
    async *stream() {
      for (const [index, chunk] of chunks.entries()) {
        yield chunk;
        onChunk?.(index);
      }
      if (failure) throw failure;
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

  it("brings in picked lore that the request mentions from chapter 1, with no user turns to scan", async () => {
    const setup = fanficStorage();
    addLore(setup);
    const llm = proseLlm(["Snow fell on Soho."]);

    await drain(
      startFanficGeneration(
        { storage: setup.storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );

    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("LORE-SHOP: The bookshop is A.Z. Fell & Co. in Soho.");
    expect(prompt).not.toContain("LORE-TADFIELD");
    expect(prompt).not.toContain("LORE-ANKH");
    // The scan-only turn never reaches the model as a message.
    expect(llm.requests[0]!.messages.filter((message) => message.role === "user")).toHaveLength(1);
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

  it("writes, rewrites and revises through the connection the fic was switched to, leaving the story as it was", async () => {
    const { storage, messages, records } = fanficStorage();
    records["conn-2"] = { id: "conn-2", name: "Drafter", provider: "test-provider", model: "other-model" };
    const llm = proseLlm(["Snow fell on Soho.", "They finally talked.", "Snow, again.", "Snow, snarkier."]);
    const deps = { storage, llm, integrations: {} as IntegrationGateway };
    // The route writes with the fic's saved connection.
    const ficConnection = () => String(records["chat-1"]!.connectionId);

    await drain(
      startFanficGeneration(deps, { chatId: "chat-1", connectionId: ficConnection(), fanficKind: "chapter" }),
    );
    const storyBefore = structuredClone((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic);
    const chapterBefore = structuredClone(messages[0]);

    // What the reader's model picker saves.
    await storage.update("chats", "chat-1", { connectionId: "conn-2" });
    expect((records["chat-1"]!.metadata as { fanfic: FanficState }).fanfic).toEqual(storyBefore);
    expect(storyBefore).toMatchObject({ outlineApproved: true, outline: approvedState.outline });
    expect(messages).toEqual([chapterBefore]);

    const chapterId = messages[0]!.id;
    await drain(
      startFanficGeneration(deps, { chatId: "chat-1", connectionId: ficConnection(), fanficKind: "chapter" }),
    );
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: ficConnection(),
        fanficKind: "regenerate",
        regenerateMessageId: chapterId,
      }),
    );
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: ficConnection(),
        fanficKind: "revise",
        regenerateMessageId: chapterId,
        notes: "Make Crowley snarkier.",
      }),
    );

    expect(llm.requests.map((request) => request.connectionId)).toEqual(["conn-1", "conn-2", "conn-2", "conn-2"]);
    expect(llm.requests.slice(1).map((request) => request.model)).toEqual([
      "other-model",
      "other-model",
      "other-model",
    ]);
    const drafter = [{ connectionId: "conn-2", name: "Drafter", model: "other-model" }];
    expect(messages[1]!.swipes[0]!.extra?.fanficVersion).toMatchObject({ models: drafter });
    expect(messages[0]!.swipes.map((swipe) => (swipe.extra?.fanficVersion as { models?: unknown })?.models)).toEqual([
      [{ connectionId: "conn-1", name: "", model: "test-model" }],
      drafter,
      drafter,
    ]);
  });

  it("records the model and how each version was made on chapters, rewrites and revisions", async () => {
    const { storage, messages, records } = fanficStorage();
    records["conn-1"] = { ...records["conn-1"], name: "Writer" };
    const llm = proseLlm(["Draft one.", "Draft two.", "Draft three, snarkier."]);
    const deps = { storage, llm, integrations: {} as IntegrationGateway };
    const writer = [{ connectionId: "conn-1", name: "Writer", model: "test-model" }];

    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "chapter",
        notes: "  Let Aziraphale win the argument.  ",
      }),
    );
    const chapterId = messages[0]!.id;
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "regenerate",
        regenerateMessageId: chapterId,
      }),
    );
    await drain(
      startFanficGeneration(deps, {
        chatId: "chat-1",
        connectionId: "conn-1",
        fanficKind: "revise",
        regenerateMessageId: chapterId,
        notes: "Make Crowley snarkier.",
      }),
    );

    expect(messages[0]!.swipes.map((swipe) => swipe.extra?.fanficVersion)).toEqual([
      { models: writer, origin: { kind: "chapter", notes: "Let Aziraphale win the argument." }, unfinished: null },
      { models: writer, origin: { kind: "regenerate", notes: "" }, unfinished: null },
      { models: writer, origin: { kind: "revise", notes: "Make Crowley snarkier.", baseVersion: 1 }, unfinished: null },
    ]);
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

describe("startFanficGeneration when a write is cut off", () => {
  const RESTARTED = "The provider restarted the reply, so it stopped at the text shown so far.";
  const BLOCKED = "Google/Gemini stopped before completing the response (finishReason: SAFETY).";
  const TIMED_OUT = "The De-Koi server sent nothing for 5 minutes, so the reply was stopped.";
  const socketClosed = () => Object.assign(new Error("Socket closed."), { code: "socket_closed" });
  // The shape the remote runtime throws when the stream goes quiet.
  const timedOut = () =>
    Object.assign(new Error(TIMED_OUT), { status: 504, details: { code: "remote_runtime_stream_timeout" } });
  const cases: Array<[string, LlmChunk[], unknown, Record<string, unknown>]> = [
    [
      "the provider restarts the reply",
      [{ type: "token", text: "The lamp" }, { type: "token", text: " flickered," }, { type: "text_reset" }],
      undefined,
      { reason: "provider_reset", code: "llm_stream_text_reset", message: RESTARTED },
    ],
    [
      "Gemini blocks the reply",
      [
        { type: "token", text: "The lamp flickered," },
        { type: "error", text: BLOCKED, data: { code: "llm_stream_incomplete", finishReason: "SAFETY" } },
      ],
      undefined,
      { reason: "content_filter", code: "llm_stream_incomplete", message: BLOCKED },
    ],
    [
      "the reply ends on a content filter",
      [
        { type: "token", text: "The lamp flickered," },
        { type: "provider_metadata", data: { finishReason: "content_filter" }, finishReason: "content_filter" },
      ],
      undefined,
      { reason: "content_filter", code: "content_filter", message: null },
    ],
    [
      "the stream fails",
      [{ type: "token", text: "The lamp flickered," }],
      socketClosed(),
      { reason: "failure", code: "socket_closed", message: "Socket closed." },
    ],
    [
      "the runtime times out",
      [{ type: "token", text: "The lamp flickered," }],
      timedOut(),
      { reason: "failure", code: "remote_runtime_stream_timeout", message: TIMED_OUT },
    ],
    [
      "the reply hits the length limit",
      [
        { type: "token", text: "The lamp flickered," },
        { type: "provider_metadata", data: { finishReason: "length" }, finishReason: "length" },
      ],
      undefined,
      { reason: "length", code: "llm_stream_length", message: expect.stringContaining("output limit") },
    ],
  ];
  const writes = [
    ["a new chapter", "chapter"],
    ["a redo", "regenerate"],
    ["a revision", "revise"],
  ] as const;

  /** Writes a finished chapter 1 first when the write rewrites one; returns the chapter message's id. */
  async function writeFirstDraft(setup: ReturnType<typeof fanficStorage>, kind: string): Promise<string | null> {
    if (kind === "chapter") return null;
    await drain(
      startFanficGeneration(
        { storage: setup.storage, llm: proseLlm(["Draft one."]), integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );
    return setup.messages[0]!.id;
  }

  const writeInput = (kind: (typeof writes)[number][1], chapterId: string | null) => ({
    chatId: "chat-1",
    connectionId: "conn-1",
    fanficKind: kind,
    ...(chapterId ? { regenerateMessageId: chapterId } : {}),
    ...(kind === "revise" ? { notes: "Make Crowley snarkier." } : {}),
  });

  describe.each(writes)("for %s", (_label, kind) => {
    it.each(cases)(
      "keeps the received text as an unfinished version when %s",
      async (_case, chunks, failure, unfinished) => {
        const setup = fanficStorage();
        const chapterId = await writeFirstDraft(setup, kind);
        const llm = streamLlm(chunks, failure);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const events = await drain(
          startFanficGeneration(
            { storage: setup.storage, llm, integrations: {} as IntegrationGateway },
            writeInput(kind, chapterId),
          ),
        );
        warn.mockRestore();

        expect(setup.messages).toHaveLength(1);
        const stored = (await setup.storage.getChatMessage<StoredMessage>(setup.messages[0]!.id))!;
        const version = stored.swipes[stored.activeSwipeIndex]!;
        expect(version.content).toBe("The lamp flickered,");
        expect(stored.content).toBe("The lamp flickered,");
        expect(version.extra?.fanficVersion).toMatchObject({ unfinished });
        expect(stored.extra.fanficVersion).toMatchObject({ unfinished });
        const shown = events.filter((event) => event.type === "assistant_message");
        expect(shown).toHaveLength(1);
        expect(shown[0]!.data).toMatchObject({ extra: { fanficVersion: { unfinished } } });
        if (chapterId) {
          expect(stored.swipes).toHaveLength(2);
          expect(stored.swipes[0]).toMatchObject({
            content: "Draft one.",
            extra: { fanficVersion: { unfinished: null } },
          });
        }
      },
    );

    it("fails as before and saves nothing when no text arrived", async () => {
      const setup = fanficStorage();
      const chapterId = await writeFirstDraft(setup, kind);
      const before = structuredClone(setup.messages);
      const failure = socketClosed();

      await expect(
        drain(
          startFanficGeneration(
            { storage: setup.storage, llm: streamLlm([], failure), integrations: {} as IntegrationGateway },
            writeInput(kind, chapterId),
          ),
        ),
      ).rejects.toBe(failure);

      expect(setup.messages).toEqual(before);
    });
  });

  it("saves each version unfinished first and marks it finished once the write ends normally", async () => {
    const { storage, messages } = fanficStorage();
    const born: unknown[] = [];
    const create = storage.createChatMessage.bind(storage);
    storage.createChatMessage = async (chatId, value) => {
      born.push(structuredClone((value.extra as Record<string, unknown>).fanficVersion));
      return create(chatId, value);
    };

    const events = await drain(
      startFanficGeneration(
        { storage, llm: proseLlm(["Snow fell on Soho."]), integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );

    expect(born).toEqual([expect.objectContaining({ unfinished: { reason: "failure", code: null, message: null } })]);
    expect(messages[0]!.extra.fanficVersion).toMatchObject({ unfinished: null });
    expect(messages[0]!.swipes[0]!.extra?.fanficVersion).toMatchObject({ unfinished: null });
    expect(events.find((event) => event.type === "assistant_message")?.data).toMatchObject({
      extra: { fanficVersion: { unfinished: null } },
    });
  });

  it("asks the provider to report restarts for every write", async () => {
    const { storage } = fanficStorage();
    const llm = proseLlm(["Snow fell on Soho."]);

    await drain(
      startFanficGeneration(
        { storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );

    expect(llm.requests[0]?.reportRestarts).toBe(true);
  });

  it("keeps a stopped chapter as finished, with its model, and still ends as a Stop", async () => {
    const { storage, messages, records } = fanficStorage();
    records["conn-1"] = { ...records["conn-1"], name: "Writer" };
    const controller = new AbortController();
    const llm = streamLlm(
      [
        { type: "token", text: "Half a" },
        { type: "token", text: " sentence" },
      ],
      undefined,
      (index) => {
        if (index === 0) controller.abort();
      },
    );

    await expect(
      drain(
        startFanficGeneration(
          { storage, llm, integrations: {} as IntegrationGateway },
          { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
          controller.signal,
        ),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(messages[0]!.content).toBe("Half a");
    expect(messages[0]!.extra.fanficVersion).toEqual({
      models: [{ connectionId: "conn-1", name: "Writer", model: "test-model" }],
      origin: { kind: "chapter", notes: "" },
      unfinished: null,
    });
  });

  it("leaves the version marked unfinished and says so when recording the outcome fails", async () => {
    const { storage, messages } = fanficStorage();
    storage.patchChatMessageExtra = async () => {
      throw new Error("disk full");
    };
    const events: GenerationEvent[] = [];

    await expect(
      (async () => {
        for await (const event of startFanficGeneration(
          { storage, llm: proseLlm(["Snow fell on Soho."]), integrations: {} as IntegrationGateway },
          { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
        ))
          events.push(event);
      })(),
    ).rejects.toMatchObject({ code: "user_facing", message: expect.stringContaining("disk full") });

    expect(messages[0]!.content).toBe("Snow fell on Soho.");
    expect(messages[0]!.extra.fanficVersion).toMatchObject({ unfinished: { reason: "failure" } });
    expect(events.find((event) => event.type === "assistant_message")?.data).toMatchObject({
      extra: { fanficVersion: { unfinished: { reason: "failure" } } },
    });
  });

  it("says the received text was lost when the cut-off chapter can't be saved", async () => {
    const { storage, messages } = fanficStorage();
    storage.createChatMessage = async () => {
      throw new Error("disk full");
    };

    await expect(
      drain(
        startFanficGeneration(
          {
            storage,
            llm: streamLlm([{ type: "token", text: "The lamp" }], socketClosed()),
            integrations: {} as IntegrationGateway,
          },
          { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
        ),
      ),
    ).rejects.toMatchObject({
      code: "generation_partial_not_saved",
      message: expect.stringMatching(/Socket closed\..*could not be saved \(disk full\)/),
    });
    expect(messages).toEqual([]);
  });
});

describe("startFanficGeneration continuing an unfinished chapter", () => {
  const WRITER = { connectionId: "conn-1", name: "Writer", model: "test-model" };
  const DRAFTER = { connectionId: "conn-2", name: "Drafter", model: "other-model" };
  const socketClosed = () => Object.assign(new Error("Socket closed."), { code: "socket_closed" });

  /** Chapter 1 cut off after "The lamp flickered," by Writer; the fic can switch to Drafter. */
  async function cutOffChapter() {
    const setup = fanficStorage();
    setup.records["conn-1"] = { ...setup.records["conn-1"], name: "Writer" };
    setup.records["conn-2"] = { id: "conn-2", name: "Drafter", provider: "test-provider", model: "other-model" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await drain(
      startFanficGeneration(
        {
          storage: setup.storage,
          llm: streamLlm([{ type: "token", text: "The lamp flickered," }], socketClosed()),
          integrations: {} as IntegrationGateway,
        },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );
    warn.mockRestore();
    return { ...setup, chapter: setup.messages[0]! };
  }

  const continueWrite = (setup: Awaited<ReturnType<typeof cutOffChapter>>, llm: LlmGateway, connectionId: string) =>
    drain(
      startFanficGeneration(
        { storage: setup.storage, llm, integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId, fanficKind: "continue", continueMessageId: setup.chapter.id },
      ),
    );

  it("appends the new text to the same version with the model that continued it", async () => {
    const setup = await cutOffChapter();
    await setup.storage.update("chats", "chat-1", { connectionId: "conn-2" });
    const llm = proseLlm(["and went out."]);

    await continueWrite(setup, llm, String(setup.records["chat-1"]!.connectionId));

    const { chapter } = setup;
    expect(setup.messages).toHaveLength(1);
    expect(chapter.swipes).toHaveLength(1);
    expect(chapter.content).toBe("The lamp flickered, and went out.");
    expect(chapter.swipes[0]!.content).toBe("The lamp flickered, and went out.");
    const version = readFanficVersion(chapter.swipes[0]!.extra);
    expect(version).toEqual({ models: [WRITER, DRAFTER], origin: { kind: "chapter", notes: "" }, unfinished: null });
    expect(fanficModelLabel(version!.models)).toBe("Writer • test-model → Drafter • other-model");
    expect(llm.requests[0]!.connectionId).toBe("conn-2");
    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("Continue chapter 1 from exactly where it stops");
    expect(prompt).toContain('"""\nThe lamp flickered,\n"""');
    expect(prompt).not.toContain("[assistant] The lamp flickered,");
  });

  it("names a model once when it continues its own chapter", async () => {
    const setup = await cutOffChapter();

    await continueWrite(setup, proseLlm(["and went out."]), "conn-1");

    expect(readFanficVersion(setup.chapter.extra)?.models).toEqual([WRITER]);
  });

  it("keeps the earlier and the new text unfinished when the continuation is cut off too", async () => {
    const setup = await cutOffChapter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await continueWrite(
      setup,
      streamLlm([{ type: "token", text: " and went" }, { type: "text_reset" }], undefined),
      "conn-2",
    );
    warn.mockRestore();

    expect(setup.chapter.content).toBe("The lamp flickered, and went");
    expect(readFanficVersion(setup.chapter.swipes[0]!.extra)).toMatchObject({
      models: [WRITER, DRAFTER],
      unfinished: { reason: "provider_reset", code: "llm_stream_text_reset" },
    });
  });

  it("leaves the chapter unfinished and unchanged when the continuation fails before any text", async () => {
    const setup = await cutOffChapter();
    const before = structuredClone(setup.chapter);
    const failure = socketClosed();

    await expect(continueWrite(setup, streamLlm([], failure), "conn-2")).rejects.toBe(failure);

    expect(setup.chapter).toEqual(before);
    expect(readFanficVersion(setup.chapter.extra)?.unfinished).toMatchObject({ reason: "failure" });
  });

  it("only continues a chapter whose shown version is unfinished", async () => {
    const setup = fanficStorage();
    await drain(
      startFanficGeneration(
        { storage: setup.storage, llm: proseLlm(["Snow fell on Soho."]), integrations: {} as IntegrationGateway },
        { chatId: "chat-1", connectionId: "conn-1", fanficKind: "chapter" },
      ),
    );
    const llm = proseLlm(["More snow."]);

    await expect(
      drain(
        startFanficGeneration(
          { storage: setup.storage, llm, integrations: {} as IntegrationGateway },
          {
            chatId: "chat-1",
            connectionId: "conn-1",
            fanficKind: "continue",
            continueMessageId: setup.messages[0]!.id,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "user_facing", message: "Only an unfinished chapter can be continued." });
    expect(llm.requests).toHaveLength(0);
  });
});

describe("resolving an unfinished chapter", () => {
  const WRITER = { connectionId: "conn-1", name: "Writer", model: "test-model" };
  const DRAFTER = { connectionId: "conn-2", name: "Drafter", model: "other-model" };
  const BLOCKED = "Chapter 1 is unfinished: Reset, Continue or Keep it as is first.";
  const socketClosed = () => Object.assign(new Error("Socket closed."), { code: "socket_closed" });

  function setup() {
    const fic = fanficStorage();
    fic.records["conn-1"] = { ...fic.records["conn-1"], name: "Writer" };
    fic.records["conn-2"] = { id: "conn-2", name: "Drafter", provider: "test-provider", model: "other-model" };
    const write = async (llm: LlmGateway, input: Partial<StartFanficGenerationInput>) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        return await drain(
          startFanficGeneration(
            { storage: fic.storage, llm, integrations: {} as IntegrationGateway },
            {
              chatId: "chat-1",
              connectionId: String(fic.records["chat-1"]!.connectionId),
              fanficKind: "chapter",
              ...input,
            },
          ),
        );
      } finally {
        warn.mockRestore();
      }
    };
    const cutOff = (text: string) => streamLlm([{ type: "token", text }], socketClosed());
    return { ...fic, write, cutOff };
  }

  /** Chapter 1 cut off on its first write. */
  async function cutOffChapter() {
    const fic = setup();
    await fic.write(fic.cutOff("The lamp flickered,"), { notes: "Make it snow." });
    return { ...fic, chapter: fic.messages[0]! };
  }

  /** Chapter 1 finished ("Draft one."), then a redo or revision of it cut off as version 2. */
  async function cutOffRewrite(kind: "regenerate" | "revise") {
    const fic = setup();
    await fic.write(proseLlm(["Draft one."]), {});
    const chapter = fic.messages[0]!;
    await fic.write(fic.cutOff("Draft two, cut"), {
      fanficKind: kind,
      regenerateMessageId: chapter.id,
      ...(kind === "revise" ? { notes: "Snarkier." } : {}),
    });
    return { ...fic, chapter };
  }

  const versionOf = (swipe: { extra?: Record<string, unknown> } | undefined) => readFanficVersion(swipe?.extra);

  it("keeps an unfinished chapter as it is, marked finished", async () => {
    const fic = await cutOffChapter();

    await keepFanficVersion(fic.storage, { chatId: "chat-1", messageId: fic.chapter.id });

    expect(fic.chapter.content).toBe("The lamp flickered,");
    expect(versionOf(fic.chapter.swipes[0])).toEqual({
      models: [WRITER],
      origin: { kind: "chapter", notes: "Make it snow." },
      unfinished: null,
    });
  });

  it("resets a cut-off new chapter by writing it again with the edited notes and the current model", async () => {
    const fic = await cutOffChapter();
    await fic.storage.update("chats", "chat-1", { connectionId: "conn-2" });
    const llm = proseLlm(["Fresh chapter."]);

    await fic.write(llm, {
      fanficKind: "chapter",
      regenerateMessageId: fic.chapter.id,
      replacesVersion: 0,
      notes: "Make it snow harder.",
    });

    expect(fic.messages).toHaveLength(1);
    expect(fic.chapter.swipes.map((swipe) => swipe.content)).toEqual(["Fresh chapter."]);
    expect(fic.chapter.content).toBe("Fresh chapter.");
    expect(versionOf(fic.chapter.swipes[0])).toEqual({
      models: [DRAFTER],
      origin: { kind: "chapter", notes: "Make it snow harder." },
      unfinished: null,
    });
    expect(llm.requests[0]!.connectionId).toBe("conn-2");
    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("Write chapter 1 now");
    expect(prompt).toContain("Make it snow harder.");
    expect(prompt).not.toContain("The lamp flickered,");
  });

  it("resets a cut-off revision by rewriting the version it was based on with the edited notes", async () => {
    const fic = await cutOffRewrite("revise");
    const llm = proseLlm(["Draft three."]);

    await fic.write(llm, {
      fanficKind: "revise",
      regenerateMessageId: fic.chapter.id,
      replacesVersion: 1,
      notes: "Much snarkier.",
    });

    expect(fic.chapter.swipes.map((swipe) => swipe.content)).toEqual(["Draft one.", "Draft three."]);
    expect(fic.chapter.activeSwipeIndex).toBe(1);
    expect(fic.chapter.content).toBe("Draft three.");
    expect(versionOf(fic.chapter.swipes[1])).toMatchObject({
      origin: { kind: "revise", notes: "Much snarkier.", baseVersion: 0 },
      unfinished: null,
    });
    expect(versionOf(fic.chapter.swipes[0])).toMatchObject({ origin: { kind: "chapter" }, unfinished: null });
    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain('Previous draft:\n"""\nDraft one.\n"""');
    expect(prompt).not.toContain("Draft two, cut");
  });

  it("resets a cut-off redo with empty notes as a plain redo", async () => {
    const fic = await cutOffRewrite("regenerate");
    const llm = proseLlm(["Again."]);

    await fic.write(llm, { fanficKind: "regenerate", regenerateMessageId: fic.chapter.id, replacesVersion: 1 });

    expect(fic.chapter.swipes.map((swipe) => swipe.content)).toEqual(["Draft one.", "Again."]);
    expect(versionOf(fic.chapter.swipes[1])).toMatchObject({
      origin: { kind: "regenerate", notes: "" },
      unfinished: null,
    });
    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("Write chapter 1 now");
    expect(prompt).not.toContain("Requester's notes");
  });

  it("replaces the unfinished version with a reset that is cut off too, which stays unfinished", async () => {
    const fic = await cutOffRewrite("regenerate");

    await fic.write(fic.cutOff("Half again"), {
      fanficKind: "regenerate",
      regenerateMessageId: fic.chapter.id,
      replacesVersion: 1,
    });

    expect(fic.chapter.swipes.map((swipe) => swipe.content)).toEqual(["Draft one.", "Half again"]);
    expect(fic.chapter.activeSwipeIndex).toBe(1);
    expect(versionOf(fic.chapter.swipes[1])?.unfinished).toMatchObject({ reason: "failure", code: "socket_closed" });
  });

  it("keeps the unfinished version when the reset fails before any text", async () => {
    const fic = await cutOffRewrite("regenerate");
    const before = structuredClone(fic.chapter);
    const failure = socketClosed();

    await expect(
      fic.write(streamLlm([], failure), {
        fanficKind: "regenerate",
        regenerateMessageId: fic.chapter.id,
        replacesVersion: 1,
      }),
    ).rejects.toBe(failure);

    expect(fic.chapter).toEqual(before);
    expect(fic.deletedSwipes).toEqual([]);
  });

  it("only resets the version the chapter shows, when it is unfinished", async () => {
    const fic = await cutOffRewrite("regenerate");

    await expect(
      fic.write(proseLlm(["Again."]), {
        fanficKind: "regenerate",
        regenerateMessageId: fic.chapter.id,
        replacesVersion: 0,
      }),
    ).rejects.toThrow("Reset only replaces the unfinished version the chapter shows.");
  });

  it("blocks every other chapter write while a chapter is unfinished, and allows Continue", async () => {
    const fic = await cutOffChapter();
    const llm = proseLlm(["Never.", "Never.", "Never.", "and went out."]);

    await expect(fic.write(llm, { fanficKind: "chapter" })).rejects.toMatchObject({
      code: "user_facing",
      message: BLOCKED,
    });
    await expect(fic.write(llm, { fanficKind: "regenerate", regenerateMessageId: fic.chapter.id })).rejects.toThrow(
      BLOCKED,
    );
    await expect(
      fic.write(llm, { fanficKind: "revise", regenerateMessageId: fic.chapter.id, notes: "Snarkier." }),
    ).rejects.toThrow(BLOCKED);
    expect(llm.requests).toHaveLength(0);

    await fic.write(llm, { fanficKind: "continue", continueMessageId: fic.chapter.id });
    expect(fic.chapter.content).toBe("The lamp flickered, Never.");
  });

  it("blocks the edits that save a new version while a chapter is unfinished", async () => {
    const fic = await cutOffChapter();
    const llm = proseLlm([], "{}");
    const deps = { storage: fic.storage, llm };
    const textKey = fanficChapterTextKey("The lamp flickered,");

    await expect(
      suggestFanficPassageRewrite(deps, {
        chatId: "chat-1",
        messageId: fic.chapter.id,
        textKey,
        selected: "The lamp flickered,",
        instruction: "Darker.",
      }),
    ).rejects.toThrow(BLOCKED);
    await expect(removeFanficBannedPhrasesFrom(deps, { chatId: "chat-1", messageId: fic.chapter.id })).rejects.toThrow(
      BLOCKED,
    );
    await expect(
      rewriteFanficFlaggedScenes(deps, {
        chatId: "chat-1",
        report: { messageId: fic.chapter.id, textKey, flags: [] } as unknown as FanficEditorReport,
      }),
    ).rejects.toThrow(BLOCKED);
    await expect(
      applyFanficContinuityFixesToChapter(fic.storage, {
        chatId: "chat-1",
        check: { messageId: fic.chapter.id, textKey, model: WRITER },
        fixes: [{ find: "lamp", replace: "candle" }],
      }),
    ).rejects.toThrow(BLOCKED);
    expect(llm.requests).toHaveLength(0);
  });

  it("lifts the block when the chapter shows a finished version again", async () => {
    const fic = await cutOffRewrite("regenerate");
    await expect(fic.write(proseLlm(["Chapter two."]), { fanficKind: "chapter" })).rejects.toThrow(BLOCKED);

    // What switching versions writes.
    const shown = fic.chapter.swipes[0]!;
    await fic.storage.updateChatMessage(fic.chapter.id, {
      activeSwipeIndex: 0,
      content: shown.content,
      extra: shown.extra,
    });
    await fic.write(proseLlm(["Chapter two."]), { fanficKind: "chapter" });

    expect(fic.messages.map((message) => message.content)).toEqual(["Draft one.", "Chapter two."]);
  });
});

describe("settleFanficWrite", () => {
  const BORN: FanficVersion = {
    models: [{ connectionId: "conn-1", name: "Writer", model: "test-model" }],
    origin: { kind: "chapter", notes: "" },
    unfinished: { reason: "failure", code: null, message: null },
  };

  async function savedChapter() {
    const fic = fanficStorage();
    const saved = await fic.storage.createChatMessage<StoredMessage>("chat-1", {
      role: "assistant",
      content: "Snow fell on Soho.",
      extra: { fanficVersion: BORN },
    });
    return { ...fic, saved: structuredClone(saved) };
  }

  it("gives the settled record to every later event for the saved chapter", async () => {
    const { storage, messages, saved } = await savedChapter();
    async function* events(): AsyncGenerator<GenerationEvent> {
      yield { type: "assistant_message", data: saved };
      // Work after the save (agents, sprites, illustrations) re-sends the row it read before the settle.
      yield { type: "assistant_message", data: { ...saved, extra: { ...saved.extra, attachments: [{ id: "a1" }] } } };
      yield { type: "done" };
    }

    const shown = (await drain(settleFanficWrite(storage, BORN, events(), undefined, null))).filter(
      (event) => event.type === "assistant_message",
    );

    expect(shown).toHaveLength(2);
    for (const event of shown) {
      expect(event.data).toMatchObject({ extra: { fanficVersion: { unfinished: null } } });
    }
    expect(shown[1]!.data).toMatchObject({ extra: { attachments: [{ id: "a1" }] } });
    expect(messages[0]!.extra.fanficVersion).toMatchObject({ unfinished: null });
  });

  it("keeps a chapter saved whole finished when work after the save fails, and passes the error on", async () => {
    const { storage, messages, saved } = await savedChapter();
    const failure = new Error("Saving the tracker snapshot failed.");
    async function* events(): AsyncGenerator<GenerationEvent> {
      yield { type: "assistant_message", data: saved };
      throw failure;
    }
    const shown: GenerationEvent[] = [];

    await expect(
      (async () => {
        for await (const event of settleFanficWrite(storage, BORN, events(), undefined, null)) shown.push(event);
      })(),
    ).rejects.toBe(failure);

    expect(messages[0]!.extra.fanficVersion).toMatchObject({ unfinished: null });
    expect(shown[0]!.data).toMatchObject({ extra: { fanficVersion: { unfinished: null } } });
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

  it("plans with the picked lore that the request mentions", async () => {
    const setup = fanficStorage({ ...approvedState, outline: null, outlineApproved: false });
    addLore(setup);
    const llm = proseLlm(
      [],
      '{"title":"T","summary":"S","chapters":[{"title":"A","summary":"a"},{"title":"B","summary":"b"}]}',
    );

    await generateFanficOutline({ storage: setup.storage, llm }, { chatId: "chat-1" });

    const prompt = promptText(llm.requests[0]);
    expect(prompt).toContain("## World info\nLORE-SHOP: The bookshop is A.Z. Fell & Co. in Soho.");
    expect(prompt).not.toContain("LORE-TADFIELD");
    expect(prompt).not.toContain("LORE-ANKH");
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
    expect(records["chat-1"]!.metadata).not.toHaveProperty("activeLorebookIds");
  });

  it("saves the picked lorebooks with the request", async () => {
    const { storage, records } = fanficStorage();
    await saveFanficRequest(storage, {
      chatId: "chat-1",
      request,
      connectionId: "conn-1",
      characterIds: [],
      lorebookIds: ["lb-omens", "lb-omens", "lb-house"],
    });
    expect(records["chat-1"]!.metadata).toMatchObject({ activeLorebookIds: ["lb-omens", "lb-house"] });
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

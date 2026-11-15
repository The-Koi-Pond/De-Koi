import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import { baseTranceOnChat, readTranceDraftPitches, startTranceFromChat } from "./from-chat";
import { buildTranceRequestPrompt, pickTranceShape } from "./prompts";
import { createTranceState, defaultTranceRequest, normalizeTranceRequest, readTranceState } from "./request";
import { saveTranceRequest } from "./session";
import { buildTranceShare, parseTranceShare } from "./share";
import { readTranceSource } from "./source";

const pitch = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  summary: `${title}, as a session.`,
  sample: ["The lamp is still lit.", "You can hear the sea."],
  type: "gentle",
  category: "relax",
  features: [],
  minutes: 10,
  ending: "wake",
  idea: "the lighthouse lamp",
  basis: "The lighthouse where they met; Vex calls them little moth.",
  ...extra,
});
const ideasReply = JSON.stringify({ pitches: [pitch("Lamp Watch"), pitch("Low Tide"), pitch("Map Room")] });

function setup(options: { mode?: string; characterIds?: string[]; messages?: Record<string, unknown>[] } = {}) {
  const chats = new Map<string, Record<string, unknown>>([
    [
      "rp",
      {
        id: "rp",
        name: "Sky Heist",
        mode: options.mode ?? "roleplay",
        characterIds: options.characterIds ?? ["vex", "pip"],
        personaId: "me",
        connectionId: "rp-conn",
        metadata: { summary: "Earlier, Rook lost a bet to Vex." },
      },
    ],
  ]);
  const messages = options.messages ?? [
    {
      id: "1",
      chatId: "rp",
      role: "assistant",
      characterId: "vex",
      content: "Give back the map, little moth.",
      createdAt: "2026-01-01T00:00:01Z",
    },
    { id: "2", chatId: "rp", role: "user", content: "Make me.", createdAt: "2026-01-01T00:00:02Z" },
  ];
  const created: Record<string, unknown>[] = [];
  const cards: Record<string, string> = { vex: "Vex", pip: "Pip" };
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections" && id === "rp-conn") return { id, provider: "openai" } as T;
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
      const row = { id: `trance-${created.length + 1}`, ...value };
      created.push(row);
      chats.set(row.id, row);
      return row as T;
    },
    async update(_entity: StorageEntity, id: string, value: Record<string, unknown>) {
      chats.set(id, { ...chats.get(id), ...value });
      return chats.get(id);
    },
    async patchChatMetadata(id: string, patch: Record<string, unknown>) {
      const row = chats.get(id)!;
      chats.set(id, { ...row, metadata: { ...(row.metadata as Record<string, unknown>), ...patch } });
    },
  } as unknown as StorageGateway;
  return { storage, created, chats };
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

describe("making a trance from a chat", () => {
  it("drafts three ideas from the chat in the guide's voice and opens a new session on them", async () => {
    const { storage, created } = setup();
    const { llm, requests } = llmReplying(ideasReply);
    const session = await startTranceFromChat({ storage, llm }, { chatId: "rp" });

    expect(requests[0]!.connectionId).toBe("rp-conn");
    const prompt = requests[0]!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("## Made from a roleplay");
    expect(prompt).toContain("The listener plays Rook in it.");
    expect(prompt).toContain("Earlier, Rook lost a bet to Vex.");
    expect(prompt).toContain("Vex: Give back the map, little moth.\n\nRook: Make me.");
    expect(prompt).toContain('"basis": ""');

    expect(created).toHaveLength(1);
    expect(session).toMatchObject({
      name: "Vex - Trance",
      mode: "trance",
      characterIds: ["vex"],
      connectionId: "rp-conn",
    });
    const metadata = session.metadata as Record<string, unknown>;
    expect(readTranceSource(metadata)).toEqual({ version: 1, chatId: "rp", mode: "roleplay", name: "Sky Heist" });
    const ideas = readTranceDraftPitches(metadata);
    expect(ideas.map((idea) => idea.title)).toEqual(["Lamp Watch", "Low Tide", "Map Room"]);
    expect(ideas[0]!.request.basis).toBe("The lighthouse where they met; Vex calls them little moth.");
    expect(ideas[0]!.request.pitch?.sample[0]).toBe("The lamp is still lit.");
    // How they feel is asked on the form, not guessed from the chat.
    expect(ideas[0]!.request.moods).toEqual([]);
  });

  it("can be guided by another of the chat's characters", async () => {
    const { storage } = setup();
    const { llm, requests } = llmReplying(ideasReply);
    const session = await startTranceFromChat({ storage, llm }, { chatId: "rp", characterId: "pip" });
    expect(session).toMatchObject({ name: "Pip - Trance", characterIds: ["pip"] });
    expect(requests[0]!.messages[1]!.content).toContain("Pip");
  });

  it("reads a fic's chapters, not the requests between them", async () => {
    const { storage } = setup({
      mode: "fanfic",
      messages: [
        { id: "1", chatId: "rp", role: "user", content: "Write chapter 1: Lamp.", createdAt: "2026-01-01T00:00:01Z" },
        {
          id: "2",
          chatId: "rp",
          role: "assistant",
          content: "The lamp burned all night.",
          createdAt: "2026-01-01T00:00:02Z",
        },
      ],
    });
    const { llm, requests } = llmReplying(ideasReply);
    await startTranceFromChat({ storage, llm }, { chatId: "rp" });
    const prompt = requests[0]!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("## The fic it comes from: Sky Heist");
    expect(prompt).toContain("Chapter: The lamp burned all night.");
    expect(prompt).not.toContain("Write chapter 1");
  });

  it("creates nothing when the ideas can't be drafted, and refuses chats it can't use", async () => {
    const failing = setup();
    await expect(
      startTranceFromChat({ storage: failing.storage, llm: llmReplying("fail").llm }, { chatId: "rp" }),
    ).rejects.toThrow("provider down");
    expect(failing.created).toHaveLength(0);

    const noCast = setup({ characterIds: [] });
    await expect(
      startTranceFromChat({ storage: noCast.storage, llm: llmReplying(ideasReply).llm }, { chatId: "rp" }),
    ).rejects.toThrow("no character");

    const trance = setup({ mode: "trance" });
    await expect(
      startTranceFromChat({ storage: trance.storage, llm: llmReplying(ideasReply).llm }, { chatId: "rp" }),
    ).rejects.toThrow("Only chats, roleplays and fics");

    const empty = setup({ messages: [] });
    await expect(
      startTranceFromChat({ storage: empty.storage, llm: llmReplying(ideasReply).llm }, { chatId: "rp" }),
    ).rejects.toThrow("nothing in this chat");
  });

  it("bases a new, empty session on a chat in place, and leaves one with settings alone", async () => {
    const { storage, chats, created } = setup();
    chats.set("t1", {
      id: "t1",
      name: "New Trance",
      mode: "trance",
      characterIds: [],
      connectionId: null,
      metadata: {},
    });
    await baseTranceOnChat({ storage, llm: llmReplying(ideasReply).llm }, { tranceChatId: "t1", chatId: "rp" });
    const session = chats.get("t1")!;
    expect(created).toHaveLength(0);
    expect(session).toMatchObject({ name: "Vex - Trance", characterIds: ["vex"], connectionId: "rp-conn" });
    expect(readTranceSource(session.metadata)?.chatId).toBe("rp");
    expect(readTranceDraftPitches(session.metadata)).toHaveLength(3);

    chats.set("t2", {
      id: "t2",
      name: "Mine",
      mode: "trance",
      characterIds: ["pip"],
      metadata: { trance: createTranceState(defaultTranceRequest()) },
    });
    await expect(
      baseTranceOnChat({ storage, llm: llmReplying(ideasReply).llm }, { tranceChatId: "t2", chatId: "rp" }),
    ).rejects.toThrow("already has settings");
    expect(chats.get("t2")).toMatchObject({ name: "Mine", characterIds: ["pip"] });
  });

  it("stops opening on the drafted ideas once a request is saved", async () => {
    const { storage, chats } = setup();
    const session = await startTranceFromChat({ storage, llm: llmReplying(ideasReply).llm }, { chatId: "rp" });
    const id = String(session.id);
    const [idea] = readTranceDraftPitches(session.metadata);
    await saveTranceRequest(storage, {
      chatId: id,
      request: idea!.request,
      connectionId: "rp-conn",
      characterId: "vex",
    });
    const metadata = chats.get(id)!.metadata as Record<string, unknown>;
    expect(readTranceDraftPitches(metadata)).toEqual([]);
    expect(readTranceState(metadata)?.request.basis).toBe(idea!.request.basis);
    expect(readTranceSource(metadata)?.chatId).toBe("rp");
  });
});

describe("what a session draws on", () => {
  it("reads sessions saved before it existed with nothing to draw on", () => {
    const { basis: _drop, ...older } = defaultTranceRequest();
    expect(normalizeTranceRequest(older).basis).toBe("");
    expect(normalizeTranceRequest({ basis: "x".repeat(5000) }).basis).toHaveLength(1200);
  });

  it("goes into the script prompt only when there is something to draw on", () => {
    const card = { name: "Vex", description: "", personality: "", scenario: "", mesExample: "" };
    const shape = pickTranceShape(() => 0);
    expect(buildTranceRequestPrompt(defaultTranceRequest(), card, shape)).not.toContain("What you and the listener");
    const prompt = buildTranceRequestPrompt({ ...defaultTranceRequest(), basis: "The lighthouse." }, card, shape);
    expect(prompt).toContain("## What you and the listener share");
    expect(prompt).toContain("The lighthouse.");
  });

  it("never leaves the sharer's De-Koi in a shared file", () => {
    const state = {
      ...createTranceState({ ...defaultTranceRequest(), basis: "Private chat detail." }),
      script: {
        lines: [{ phase: "pretalk" as const, text: "Hello." }],
        exits: { gentle: [], calm: [] },
        connectionId: null,
        createdAt: "2026-11-15T00:00:00Z",
      },
    };
    const share = buildTranceShare(state, "Vex", new Date("2026-11-15T00:00:00Z"));
    expect(share.request.basis).toBe("");
    expect(parseTranceShare({ ...share, request: { ...share.request, basis: "sneaky" } }).request.basis).toBe("");
  });
});

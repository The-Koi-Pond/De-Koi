import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import {
  buildFanficCommentSegments,
  createFanficCommentThread,
  loadFanficCommentContext,
  readFanficCommentThread,
} from "./comments";
import { fanficChapterTextKey } from "./ledger";
import { createFanficState, defaultFanficRequest } from "./request";

const request = { ...defaultFanficRequest(), fandom: "The Freak Circus", characters: ["Harlequin"], chapterCount: 3 };
const outline = {
  title: "Collection",
  summary: "",
  chapters: [
    { number: 1, title: "Terms", summary: "They set a safe word." },
    { number: 2, title: "The Turn", summary: "Pierrot leaves the circus." },
    { number: 3, title: "After", summary: "They make up." },
  ],
};
const state: FanficState = { ...createFanficState(request), outline, outlineApproved: true };
const version = (connectionId: string) => ({
  fanficVersion: { models: [{ connectionId, name: "Writer", model: "w-1" }], origin: { kind: "chapter", notes: "" } },
});

function storageWith(options: { connections?: string[] } = {}) {
  const chats = new Map<string, Record<string, unknown>>([
    ["fic", { id: "fic", mode: "fanfic", connectionId: "fic-conn", metadata: { fanfic: state } }],
  ]);
  const messages = [
    { id: "m1", chatId: "fic", role: "assistant", content: "They set the word: bells.", extra: version("writer-conn") },
    { id: "m2", chatId: "fic", role: "assistant", content: "Pierrot walked out at dawn.", extra: version("gone-conn") },
  ];
  const connections = new Set(options.connections ?? ["writer-conn", "fic-conn"]);
  const created: Record<string, unknown>[] = [];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "connections") return (connections.has(id) ? { id } : null) as T | null;
      return null;
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async create<T = unknown>(entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      const row = { id: `thread-${created.length + 1}`, ...value };
      created.push(row);
      if (entity === "chats") chats.set(row.id, row);
      return row as T;
    },
  } as unknown as StorageGateway;
  return { storage, chats, created };
}

describe("fanfic comment threads", () => {
  it("opens a thread as a chat the fic owns, answered by the model that wrote the chapter", async () => {
    const { storage } = storageWith();
    const thread = await createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "m1" });
    expect(thread).toMatchObject({ mode: "fanfic", ownerChatId: "fic", connectionId: "writer-conn", characterIds: [] });
    expect(readFanficCommentThread(thread.metadata)).toEqual({
      version: 1,
      ficChatId: "fic",
      chapterMessageId: "m1",
      chapterLabel: "1",
      textKey: fanficChapterTextKey("They set the word: bells."),
    });
  });

  it("falls back to the fic's connection when the chapter's writer is gone", async () => {
    const { storage } = storageWith();
    const thread = await createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "m2" });
    expect(thread.connectionId).toBe("fic-conn");
  });

  it("refuses a thread under a thread, and a chapter that isn't in the fic", async () => {
    const { storage } = storageWith();
    const thread = await createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "m1" });
    await expect(
      createFanficCommentThread(storage, { ficChatId: String(thread.id), chapterMessageId: "m1" }),
    ).rejects.toThrow("That fic is no longer here.");
    await expect(createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "nope" })).rejects.toThrow(
      "That chapter is no longer in this fic.",
    );
  });

  it("builds the author's comment prompt from the fic as it is now, with the commented chapter in full", async () => {
    const { storage } = storageWith();
    const thread = await createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "m2" });
    const context = await loadFanficCommentContext(storage, thread.metadata);
    const prompt = buildFanficCommentSegments(context!)
      .map((segment) => segment.content)
      .join("\n\n");
    expect(prompt).toContain("answer as the author in the chapter's comments");
    expect(prompt).toContain("two or three concrete alternatives");
    expect(prompt).toContain("Chapter 2: The Turn");
    expect(prompt).toContain("2 of 3 planned chapters are written.");
    expect(prompt).toContain("This is chapter 2: The Turn as it reads now.\n\nPierrot walked out at dawn.");
    // The writing prompt's rules never reach the comments.
    expect(prompt).not.toContain("Output only the chapter's prose");
  });

  it("says so when the chapter was rewritten after the thread started", async () => {
    const { storage } = storageWith();
    const thread = await createFanficCommentThread(storage, { ficChatId: "fic", chapterMessageId: "m1" });
    const context = (await loadFanficCommentContext(storage, thread.metadata))!;
    context.ficMessages = context.ficMessages.map((message) =>
      message.id === "m1" ? { ...message, content: "A different chapter one." } : message,
    );
    const prompt = buildFanficCommentSegments(context)
      .map((segment) => segment.content)
      .join("\n\n");
    expect(prompt).toContain("rewritten since this thread started");
  });

  it("is not a comment context for an ordinary chat", async () => {
    const { storage } = storageWith();
    await expect(loadFanficCommentContext(storage, { fanfic: state })).resolves.toBeNull();
  });
});

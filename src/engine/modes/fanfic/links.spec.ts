import { describe, expect, it } from "vitest";

import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import {
  buildFanficLinkedChatsSection,
  buildLinkedFicContext,
  FANFIC_MAX_LINKED_CHATS,
  linkFanficChat,
  readFanficLink,
  readFanficLinkedChatIds,
  unlinkFanficChat,
} from "./links";
import { createFanficState, defaultFanficRequest } from "./request";

const outline = {
  title: "Collection",
  summary: "",
  chapters: [
    { number: 1, title: "Terms", summary: "They set a safe word." },
    { number: 2, title: "After", summary: "Pierrot waits at the gate." },
    { number: 3, title: "End", summary: "" },
  ],
};
const state: FanficState = { ...createFanficState(defaultFanficRequest()), outline, outlineApproved: true };

function setup() {
  const chats = new Map<string, Record<string, unknown>>([
    ["fic", { id: "fic", name: "My fic", mode: "fanfic", metadata: { fanfic: state } }],
    ["fic2", { id: "fic2", name: "Other fic", mode: "fanfic", metadata: { fanfic: state } }],
    ["rp", { id: "rp", name: "Big Top", mode: "roleplay", characterIds: ["harl"], personaId: "me", metadata: {} }],
    ["dm", { id: "dm", name: "Texts", mode: "conversation", characterIds: ["harl"], metadata: {} }],
    ["thread", { id: "thread", name: "Comments", mode: "fanfic", ownerChatId: "fic", metadata: {} }],
  ]);
  const messages: Record<string, unknown>[] = [
    {
      chatId: "fic",
      role: "assistant",
      content: "Chapter one: they set the word, bells.",
      createdAt: "2026-01-01T10:00:00Z",
    },
    {
      chatId: "fic",
      role: "assistant",
      content: "Chapter two ends with Pierrot at the gate.",
      createdAt: "2026-01-02T10:00:00Z",
    },
    { chatId: "rp", role: "user", content: "I hand Harlequin the bell.", createdAt: "2026-01-01T12:00:00Z" },
    {
      chatId: "rp",
      role: "assistant",
      characterId: "harl",
      content: "He pockets it.",
      createdAt: "2026-01-02T12:00:00Z",
    },
    {
      chatId: "rp",
      role: "narrator",
      content: "Hidden scene note.",
      extra: { hiddenFromUser: true },
      createdAt: "2026-01-02T12:30:00Z",
    },
    { chatId: "rp", role: "user", content: "We leave for the coast.", createdAt: "2026-01-02T13:00:00Z" },
  ];
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (chats.get(id) ?? null) as T | null;
      if (entity === "characters" && id === "harl") return { id, data: { name: "Harlequin" } } as T;
      if (entity === "personas" && id === "me") return { id, name: "Chai" } as T;
      return null;
    },
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return messages.filter((message) => message.chatId === chatId) as T[];
    },
    async patchChatMetadata(id: string, patch: Record<string, unknown>) {
      const row = chats.get(id)!;
      chats.set(id, { ...row, metadata: { ...(row.metadata as Record<string, unknown>), ...patch } });
    },
  } as unknown as StorageGateway;
  return { storage, chats, messages };
}

describe("fic and chat links", () => {
  it("links both ways, moves a chat's link to a new fic, and unlinks both sides", async () => {
    const { storage, chats } = setup();
    await linkFanficChat(storage, { ficChatId: "fic", chatId: "rp" });
    expect(readFanficLinkedChatIds(chats.get("fic")!.metadata)).toEqual(["rp"]);
    expect(readFanficLink(chats.get("rp")!.metadata)).toBe("fic");

    await linkFanficChat(storage, { ficChatId: "fic2", chatId: "rp" });
    expect(readFanficLinkedChatIds(chats.get("fic")!.metadata)).toEqual([]);
    expect(readFanficLinkedChatIds(chats.get("fic2")!.metadata)).toEqual(["rp"]);
    expect(readFanficLink(chats.get("rp")!.metadata)).toBe("fic2");

    await unlinkFanficChat(storage, { ficChatId: "fic2", chatId: "rp" });
    expect(readFanficLinkedChatIds(chats.get("fic2")!.metadata)).toEqual([]);
    expect(readFanficLink(chats.get("rp")!.metadata)).toBeNull();
  });

  it("refuses a comment thread, a fic as the chat, and more than the cap", async () => {
    const { storage, chats } = setup();
    await expect(linkFanficChat(storage, { ficChatId: "fic", chatId: "thread" })).rejects.toThrow(
      "Only roleplays and chats can be linked to a fic.",
    );
    await expect(linkFanficChat(storage, { ficChatId: "thread", chatId: "rp" })).rejects.toThrow(
      "That fic is no longer here.",
    );
    expect(FANFIC_MAX_LINKED_CHATS).toBe(4);
    for (const id of ["a", "b", "c", "d"]) {
      chats.set(id, { id, name: id, mode: "conversation", metadata: {} });
      await linkFanficChat(storage, { ficChatId: "fic", chatId: id });
    }
    await expect(linkFanficChat(storage, { ficChatId: "fic", chatId: "rp" })).rejects.toThrow("at most");
  });

  it("doesn't count a deleted chat's leftover id against the cap", async () => {
    const { storage, chats } = setup();
    for (const id of ["a", "b", "c", "d"]) {
      chats.set(id, { id, name: id, mode: "conversation", metadata: {} });
      await linkFanficChat(storage, { ficChatId: "fic", chatId: id });
    }
    chats.delete("d");
    await linkFanficChat(storage, { ficChatId: "fic", chatId: "rp" });
    expect(readFanficLinkedChatIds(chats.get("fic")!.metadata)).toEqual(["a", "b", "c", "rp"]);
  });

  it("gives a chapter what happened in the linked chat since the previous chapter, hidden notes left out", async () => {
    const { storage, chats, messages } = setup();
    await linkFanficChat(storage, { ficChatId: "fic", chatId: "rp" });
    const ficMessages = messages.filter((message) => message.chatId === "fic");
    const section = await buildFanficLinkedChatsSection(storage, chats.get("fic")!, ficMessages);
    expect(section).toContain("## Meanwhile, in the linked chats");
    expect(section).toContain("never contradict them");
    expect(section).toContain(
      "### Roleplay: Big Top\nSince the previous chapter:\nHarlequin: He pockets it.\nChai: We leave for the coast.",
    );
    // Before chapter two, and a hidden note.
    expect(section).not.toContain("I hand Harlequin the bell.");
    expect(section).not.toContain("Hidden scene note.");
    // Chapter one of a new fic sees the whole chat so far.
    expect(await buildFanficLinkedChatsSection(storage, chats.get("fic")!, [])).toContain(
      "So far:\nChai: I hand Harlequin the bell.",
    );
  });

  it("gives a linked chat's replies where the fic stands, and ignores a link the other side dropped", async () => {
    const { storage, chats } = setup();
    await linkFanficChat(storage, { ficChatId: "fic", chatId: "rp" });
    const context = await buildLinkedFicContext(storage, chats.get("rp")!);
    expect(context).toContain('linked to the fic "Collection": 2 of 3 planned chapters written.');
    expect(context).toContain("The latest chapter (2) ends:\nChapter two ends with Pierrot at the gate.");
    // No ledger: the outline's plan for each written chapter goes in too.
    expect(context).toContain(
      "What the written chapters cover, as the outline planned them:\nChapter 1: Terms. They set a safe word.\nChapter 2: After. Pierrot waits at the gate.",
    );

    // The fic no longer lists the chat: the chat's half of the link counts for nothing.
    chats.set("fic", { ...chats.get("fic")!, metadata: { fanfic: state, fanficLinkedChatIds: [] } });
    expect(await buildLinkedFicContext(storage, chats.get("rp")!)).toBeNull();
    expect(await buildFanficLinkedChatsSection(storage, chats.get("fic")!, [])).toBe("");
  });

  it("is nothing for a chat or fic without links", async () => {
    const { storage, chats } = setup();
    expect(await buildLinkedFicContext(storage, chats.get("dm")!)).toBeNull();
    expect(await buildFanficLinkedChatsSection(storage, chats.get("fic")!, [])).toBe("");
  });
});

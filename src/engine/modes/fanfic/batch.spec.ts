import { describe, expect, it } from "vitest";

import type { FanficState } from "../../contracts/types/fanfic";
import type { StorageGateway } from "../../capabilities/storage";
import { fanficBatchContinues, fanficWriteSavedFinished, nextFanficBatchInput } from "./batch";
import { defaultFanficRequest, normalizeFanficRequest } from "./request";

const state = (approved = true): FanficState => ({
  version: 1,
  request: normalizeFanficRequest({
    ...defaultFanficRequest(),
    fandom: "Good Omens",
    prompt: "Snow.",
    chapterCount: 3,
  }),
  outline: {
    title: "Snow Day",
    summary: "Snowed in.",
    chapters: [1, 2, 3].map((number) => ({ number, title: `Ch ${number}`, summary: "Beats." })),
  },
  outlineApproved: approved,
  research: null,
});

const chapter = (id: string, unfinished = false) => ({
  id,
  chatId: "chat-1",
  role: "assistant",
  content: `Text of ${id}.`,
  extra: {
    fanficVersion: {
      models: [],
      origin: { kind: "chapter", notes: "" },
      unfinished: unfinished ? { reason: "length" } : null,
    },
  },
});

function storage(fanfic: FanficState, rows: ReturnType<typeof chapter>[]): StorageGateway {
  return {
    get: async (_entity: string, id: string) => (id === "chat-1" ? { id, mode: "fanfic", metadata: { fanfic } } : null),
    listChatMessages: async () => rows,
  } as unknown as StorageGateway;
}

const saved = (row: ReturnType<typeof chapter>) => [
  { type: "token", data: "..." },
  { type: "assistant_message", data: row },
];

describe("write all: when the run goes on", () => {
  it("goes on while the outline plans more chapters and nothing waits unfinished", async () => {
    await expect(fanficBatchContinues(storage(state(), [chapter("m1")]), "chat-1")).resolves.toBe(true);
  });

  it("stops after the last planned chapter", async () => {
    const rows = [chapter("m1"), chapter("m2"), chapter("m3")];
    await expect(fanficBatchContinues(storage(state(), rows), "chat-1")).resolves.toBe(false);
  });

  it("stops at a cut-off chapter so the requester can Reset, Continue or Keep it", async () => {
    const rows = [chapter("m1"), chapter("m2", true)];
    await expect(fanficBatchContinues(storage(state(), rows), "chat-1")).resolves.toBe(false);
  });

  it("stops when the fic is no longer in its writing stage", async () => {
    await expect(fanficBatchContinues(storage(state(false), [chapter("m1")]), "chat-1")).resolves.toBe(false);
  });

  it("only counts a write that saved a finished chapter, so an empty or cut-off write can't loop", () => {
    expect(fanficWriteSavedFinished(saved(chapter("m2")))).toBe(true);
    expect(fanficWriteSavedFinished(saved(chapter("m2", true)))).toBe(false);
    expect(fanficWriteSavedFinished([{ type: "token", data: "..." }, { type: "done" }])).toBe(false);
  });

  it("keeps the first chapter's notes to that chapter", () => {
    expect(nextFanficBatchInput({ chatId: "chat-1", fanficKind: "chapter", notes: "Bigger moment." })).toEqual({
      chatId: "chat-1",
      fanficKind: "chapter",
      notes: null,
    });
  });
});

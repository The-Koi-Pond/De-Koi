import { describe, expect, it } from "vitest";

import type { FanficState } from "../../contracts/types/fanfic";
import type { StorageGateway } from "../../capabilities/storage";
import {
  fanficBatchContinues,
  fanficFollowUpInput,
  fanficFollowUpWrite,
  fanficWriteSavedFinished,
  fanficWriteSavedFinishedId,
} from "./batch";
import { defaultFanficRequest, normalizeFanficRequest } from "./request";

const state = (approved = true, autoPolish = false): FanficState => ({
  version: 1,
  request: normalizeFanficRequest({
    ...defaultFanficRequest(),
    fandom: "Good Omens",
    prompt: "Snow.",
    chapterCount: 3,
    autoPolish,
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
    expect(
      fanficFollowUpInput({ chatId: "chat-1", fanficKind: "chapter", notes: "Bigger moment." }, { kind: "chapter" }),
    ).toEqual({ chatId: "chat-1", fanficKind: "chapter", notes: null, regenerateMessageId: null });
  });
});

describe("what follows a write by itself", () => {
  const follow = (
    fanfic: FanficState,
    rows: ReturnType<typeof chapter>[],
    write: Partial<Parameters<typeof fanficFollowUpWrite>[1]>,
  ) =>
    fanficFollowUpWrite(storage(fanfic, rows), {
      chatId: "chat-1",
      kind: "chapter",
      batch: false,
      finishedId: "m1",
      ...write,
    });

  it.each(["chapter", "extra", "regenerate", "revise", "continue"] as const)(
    "polishes the chapter a %s finished when the switch is on",
    async (kind) => {
      await expect(follow(state(true, true), [chapter("m1")], { kind })).resolves.toEqual({
        kind: "polish",
        messageId: "m1",
      });
    },
  );

  it("never polishes a polish, and nothing follows a single write's polish", async () => {
    await expect(follow(state(true, true), [chapter("m1")], { kind: "polish" })).resolves.toBeNull();
  });

  it("polishes nothing when the write saved no finished chapter", async () => {
    await expect(follow(state(true, true), [chapter("m1")], { finishedId: null })).resolves.toBeNull();
  });

  it("with the switch off, a single write ends and a run goes straight to the next chapter", async () => {
    await expect(follow(state(), [chapter("m1")], {})).resolves.toBeNull();
    await expect(follow(state(), [chapter("m1")], { batch: true })).resolves.toEqual({ kind: "chapter" });
  });

  it("in a run, writes the chapter's polish and then the next chapter", async () => {
    await expect(follow(state(true, true), [chapter("m1")], { batch: true })).resolves.toEqual({
      kind: "polish",
      messageId: "m1",
    });
    await expect(follow(state(true, true), [chapter("m1")], { batch: true, kind: "polish" })).resolves.toEqual({
      kind: "chapter",
    });
  });

  it("ends a run after the last chapter's polish", async () => {
    const rows = [chapter("m1"), chapter("m2"), chapter("m3")];
    await expect(
      follow(state(true, true), rows, { batch: true, kind: "polish", finishedId: "m3" }),
    ).resolves.toBeNull();
  });

  it("makes a polish input that names the chapter and drops what only the write before needed", () => {
    const input = {
      chatId: "chat-1",
      fanficKind: "continue",
      continueMessageId: "m1",
      replacesVersion: 0,
      parentChapter: 1,
      notes: "More snow.",
      fanficBatch: true,
      userTimeZone: "UTC",
    };
    expect(fanficFollowUpInput(input, { kind: "polish", messageId: "m1" })).toEqual({
      chatId: "chat-1",
      fanficKind: "polish",
      regenerateMessageId: "m1",
      notes: null,
      fanficBatch: true,
      userTimeZone: "UTC",
    });
  });

  it("reads which chapter a write finished from its events", () => {
    expect(fanficWriteSavedFinishedId(saved(chapter("m2")))).toBe("m2");
    expect(fanficWriteSavedFinishedId(saved(chapter("m2", true)))).toBeNull();
  });
});

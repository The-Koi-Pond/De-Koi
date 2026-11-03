import { describe, expect, it, vi } from "vitest";

import { fanficChapterLayout, fanficWriteContext } from "./chapter-refs";
import { deleteFanficChapter, fanficDeletePlan, setFanficChainCanon, setFanficExtraCanon } from "./extras";

type Row = { id: string; chatId: string; role: string; content: string; extra: Record<string, unknown> };

const main = (id: string): Row => ({ id, chatId: "chat-1", role: "assistant", content: `Text of ${id}.`, extra: {} });
const extra = (id: string, parentChapter: number, canon = false): Row => ({
  ...main(id),
  extra: { fanficExtra: { parentChapter, canon } },
});

function extrasStorage(rows: Row[], failOnWrite?: number) {
  const writes: Array<{ messageId: string; patch: Record<string, unknown> }> = [];
  const storage = {
    async listChatMessages<T = unknown>(chatId: string): Promise<T[]> {
      return rows.filter((row) => row.chatId === chatId).map((row) => structuredClone(row)) as T[];
    },
    async patchChatMessageExtra<T = unknown>(messageId: string, patch: Record<string, unknown>): Promise<T> {
      if (writes.length + 1 === failOnWrite) throw new Error("storage unavailable");
      writes.push({ messageId, patch });
      const row = rows.find((entry) => entry.id === messageId)!;
      row.extra = { ...row.extra, ...patch };
      return row as T;
    },
  };
  const canon = (parent: number) =>
    fanficChapterLayout(rows)
      .chains.get(parent)
      ?.map((ref) => ref.extra?.canon);
  return { storage, writes, canon };
}

describe("setFanficExtraCanon", () => {
  it("marks every earlier extra of the chain canon with it", async () => {
    const { storage, canon } = extrasStorage([main("m1"), main("m2"), main("m3"), extra("x5", 3), extra("x6", 3)]);

    await setFanficExtraCanon(storage, "chat-1", "x6", true);

    expect(canon(3)).toEqual([true, true]);
  });

  it("turns every later extra of the chain into a side story when one is unmarked", async () => {
    const { storage, canon } = extrasStorage([main("m1"), extra("x5", 1, true), extra("x6", 1, true)]);

    await setFanficExtraCanon(storage, "chat-1", "x5", false);

    expect(canon(1)).toEqual([false, false]);
  });

  it("leaves later extras as they are when an earlier one is marked canon", async () => {
    const { storage, writes, canon } = extrasStorage([main("m1"), extra("x5", 1), extra("x6", 1)]);

    await setFanficExtraCanon(storage, "chat-1", "x5", true);

    expect(canon(1)).toEqual([true, false]);
    expect(writes.map((write) => write.messageId)).toEqual(["x5"]);
  });

  it("writes only the extras whose stored flag changes, earliest first, and never their text", async () => {
    const rows = [main("m1"), extra("x5", 1, true), extra("x6", 1), extra("x7", 1), extra("x8", 1)];
    const { storage, writes } = extrasStorage(rows);

    await setFanficExtraCanon(storage, "chat-1", "x7", true);

    expect(writes).toEqual([
      { messageId: "x6", patch: { fanficExtra: { parentChapter: 1, canon: true } } },
      { messageId: "x7", patch: { fanficExtra: { parentChapter: 1, canon: true } } },
    ]);
    expect(rows.map((row) => row.content)).toEqual([
      "Text of m1.",
      "Text of x5.",
      "Text of x6.",
      "Text of x7.",
      "Text of x8.",
    ]);
  });

  it("clears a stale stored canon flag behind a side story, so it can't turn canon later", async () => {
    const { storage, writes, canon } = extrasStorage([main("m1"), extra("x5", 1), extra("x6", 1, true)]);

    await setFanficExtraCanon(storage, "chat-1", "x5", true);

    expect(writes.map((write) => [write.messageId, write.patch])).toEqual([
      ["x5", { fanficExtra: { parentChapter: 1, canon: true } }],
      ["x6", { fanficExtra: { parentChapter: 1, canon: false } }],
    ]);
    expect(canon(1)).toEqual([true, false]);
  });

  it("keeps the chain prefix-consistent and rethrows when a later write fails", async () => {
    const marking = extrasStorage([main("m1"), extra("x5", 1), extra("x6", 1), extra("x7", 1)], 2);
    await expect(setFanficExtraCanon(marking.storage, "chat-1", "x7", true)).rejects.toThrow("storage unavailable");
    expect(marking.canon(1)).toEqual([true, false, false]);

    const unmarking = extrasStorage([main("m1"), extra("x5", 1, true), extra("x6", 1, true)], 2);
    await expect(setFanficExtraCanon(unmarking.storage, "chat-1", "x5", false)).rejects.toThrow("storage unavailable");
    expect(unmarking.canon(1)).toEqual([false, false]);
  });

  it("refuses a main chapter, an extra whose chapter is gone and a message that isn't there", async () => {
    const { storage, writes } = extrasStorage([main("m1"), extra("lost", 4)]);

    await expect(setFanficExtraCanon(storage, "chat-1", "m1", true)).rejects.toThrow(/Only extra chapters/);
    await expect(setFanficExtraCanon(storage, "chat-1", "lost", true)).rejects.toThrow(/no longer in this fic/);
    await expect(setFanficExtraCanon(storage, "chat-1", "gone", true)).rejects.toThrow(/no longer in this fic/);
    expect(writes).toEqual([]);
  });

  it("puts an extra marked canon after chapter 4 was written into later writes, leaving chapter 4 as it is", async () => {
    const rows = [main("m1"), main("m2"), main("m3"), main("m4"), extra("x5", 3)];
    const { storage } = extrasStorage(rows);
    const context = (target: Parameters<typeof fanficWriteContext>[1]) =>
      fanficWriteContext(rows, target).map((row) => row.id);
    expect(context({ kind: "main" })).toEqual(["m1", "m2", "m3", "m4"]);

    await setFanficExtraCanon(storage, "chat-1", "x5", true);

    expect(context({ kind: "main" })).toEqual(["m1", "m2", "m3", "x5", "m4"]);
    expect(context({ kind: "existing", messageId: "m4" })).toEqual(["m1", "m2", "m3", "x5"]);
    expect(rows[3]).toEqual(main("m4"));
  });
});

describe("setFanficChainCanon", () => {
  it("marks every extra of the chain canon, or none", async () => {
    const { storage, canon } = extrasStorage([main("m1"), main("m2"), extra("x5", 2, true), extra("x6", 2)]);

    await setFanficChainCanon(storage, "chat-1", 2, true);
    expect(canon(2)).toEqual([true, true]);

    await setFanficChainCanon(storage, "chat-1", 2, false);
    expect(canon(2)).toEqual([false, false]);
  });

  it("refuses a chapter without extras", async () => {
    const { storage } = extrasStorage([main("m1")]);

    await expect(setFanficChainCanon(storage, "chat-1", 1, true)).rejects.toThrow(/no extra chapters/);
  });
});

describe("fanficDeletePlan", () => {
  const chain = (...canon: boolean[]) => [
    main("m1"),
    main("m2"),
    main("m3"),
    ...canon.map((flag, index) => extra(`x${5 + index}`, 3, flag)),
  ];

  it("deletes the last main chapter with its whole chain, naming each", () => {
    const plan = fanficDeletePlan(fanficChapterLayout(chain(true, false)), "m3");

    expect(plan).toEqual({ deleteIds: ["m3", "x5", "x6"], flagWrites: [], labels: ["3", "3.5", "3.6"] });
  });

  it("refuses a main chapter that isn't the last one", () => {
    const layout = fanficChapterLayout([main("m1"), extra("x5", 1), main("m2")]);

    expect(() => fanficDeletePlan(layout, "m1")).toThrow(/Only the last main chapter/);
    expect(() => fanficDeletePlan(layout, "gone")).toThrow(/no longer in this fic/);
  });

  it("deletes the first, a middle or the last extra alone, keeping the others' flags", () => {
    const layout = fanficChapterLayout(chain(true, true, false));
    const plan = (id: string) => fanficDeletePlan(layout, id);

    expect(plan("x5")).toEqual({
      deleteIds: ["x5"],
      flagWrites: [
        { messageId: "x6", canon: true },
        { messageId: "x7", canon: false },
      ],
      labels: ["3.5"],
    });
    expect(plan("x6").flagWrites).toEqual([
      { messageId: "x5", canon: true },
      { messageId: "x7", canon: false },
    ]);
    expect(plan("x7")).toEqual({
      deleteIds: ["x7"],
      flagWrites: [
        { messageId: "x5", canon: true },
        { messageId: "x6", canon: true },
      ],
      labels: ["3.7"],
    });
  });

  it("deletes an extra whose main chapter is gone on its own", () => {
    const plan = fanficDeletePlan(fanficChapterLayout([main("m1"), extra("o5", 4), extra("o6", 4)]), "o5");

    expect(plan).toEqual({ deleteIds: ["o5"], flagWrites: [], labels: ["4.5"] });
  });
});

describe("deleteFanficChapter", () => {
  function deleting(rows: Row[]) {
    const { storage, writes, canon } = extrasStorage(rows);
    const order: string[] = [];
    const patch = storage.patchChatMessageExtra;
    storage.patchChatMessageExtra = async (messageId, value) => {
      order.push(`write ${messageId}`);
      return patch(messageId, value);
    };
    const deleteMessages = async (messageIds: string[]) => {
      order.push(`delete ${messageIds.join(",")}`);
      rows.splice(0, rows.length, ...rows.filter((row) => !messageIds.includes(row.id)));
    };
    return { deps: { storage, deleteMessages }, writes, canon, order, rows };
  }

  it("renumbers the later extras, which keep their text and flags", async () => {
    const { deps, canon, rows } = deleting([
      main("m1"),
      main("m2"),
      main("m3"),
      extra("x5", 3, true),
      extra("x6", 3, true),
      extra("x7", 3),
    ]);

    await deleteFanficChapter(deps, "chat-1", "x5");

    const chain = fanficChapterLayout(rows).chains.get(3)!;
    expect(chain.map((ref) => [ref.label, ref.content])).toEqual([
      ["3.5", "Text of x6."],
      ["3.6", "Text of x7."],
    ]);
    expect(canon(3)).toEqual([true, false]);
  });

  it("writes the remaining chain's flags before the delete, so a stale canon flag can't turn canon", async () => {
    // 3.6 is stored canon behind the side story 3.5, so it reads as a side story; deleting 3.5 must not change that.
    const { deps, writes, canon, order } = deleting([
      main("m1"),
      main("m2"),
      main("m3"),
      extra("x5", 3),
      extra("x6", 3, true),
      extra("x7", 3, true),
    ]);

    await deleteFanficChapter(deps, "chat-1", "x5");

    expect(writes.map((write) => [write.messageId, write.patch])).toEqual([
      ["x6", { fanficExtra: { parentChapter: 3, canon: false } }],
      ["x7", { fanficExtra: { parentChapter: 3, canon: false } }],
    ]);
    expect(order).toEqual(["write x6", "write x7", "delete x5"]);
    expect(canon(3)).toEqual([false, false]);
  });

  it("deletes the last main chapter and its extras in one call", async () => {
    const { deps, writes, order } = deleting([main("m1"), main("m2"), extra("x5", 2, true), extra("x6", 2)]);

    const plan = await deleteFanficChapter(deps, "chat-1", "m2");

    expect(order).toEqual(["delete m2,x5,x6"]);
    expect(writes).toEqual([]);
    expect(plan.labels).toEqual(["2", "2.5", "2.6"]);
  });

  it("deletes nothing when a main chapter isn't the last one", async () => {
    const { deps, order } = deleting([main("m1"), main("m2")]);

    await expect(deleteFanficChapter(deps, "chat-1", "m1")).rejects.toThrow(/Only the last main chapter/);
    expect(order).toEqual([]);
  });

  it("leaves everything in place when a flag write fails", async () => {
    const rows = [main("m1"), extra("x5", 1), extra("x6", 1, true)];
    const { storage } = extrasStorage(rows, 1);
    const deleteMessages = vi.fn();

    await expect(deleteFanficChapter({ storage, deleteMessages }, "chat-1", "x5")).rejects.toThrow(
      "storage unavailable",
    );
    expect(deleteMessages).not.toHaveBeenCalled();
    expect(rows).toHaveLength(3);
  });
});

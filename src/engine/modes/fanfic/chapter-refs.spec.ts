import { describe, expect, it } from "vitest";

import {
  fanficCanonLine,
  fanficChapterLayout,
  fanficUnfinishedChapter,
  fanficUnfinishedReason,
  fanficWriteContext,
} from "./chapter-refs";

const main = (id: string, content = `Text of ${id}.`) => ({ id, role: "assistant", content });
const extra = (id: string, parentChapter: unknown, canon: unknown = false) => ({
  id,
  role: "assistant",
  content: `Text of ${id}.`,
  extra: { fanficExtra: { parentChapter, canon } },
});
const labels = (refs: ReadonlyArray<{ label: string }>) => refs.map((ref) => ref.label);
const ids = (refs: ReadonlyArray<{ messageId: string }>) => refs.map((ref) => ref.messageId);

describe("fanficChapterLayout", () => {
  it("numbers a chain 3.5 to 3.11 with a plain counter, so 3.10 and 3.11 never collide with 3.1", () => {
    const chain = Array.from({ length: 7 }, (_, index) => extra(`x${index}`, 3));
    const layout = fanficChapterLayout([main("m1"), main("m2"), main("m3"), ...chain]);

    expect(labels(layout.chains.get(3) ?? [])).toEqual(["3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11"]);
    expect(new Set(labels(layout.chapters)).size).toBe(layout.chapters.length);
    expect(layout.chains.get(3)?.map((ref) => ref.extra?.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads each main chapter followed by its chain, whatever order they were written in", () => {
    const layout = fanficChapterLayout([
      main("m1"),
      main("m2"),
      main("m3"),
      extra("x1", 3),
      main("m4"),
      extra("x2", 3),
    ]);

    expect(labels(layout.chapters)).toEqual(["1", "2", "3", "3.5", "3.6", "4"]);
    expect(ids(layout.chapters)).toEqual(["m1", "m2", "m3", "x1", "x2", "m4"]);
    expect(layout.chapters.map((ref) => ref.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("leaves main chapter numbers as they would be without the extras", () => {
    const layout = fanficChapterLayout([main("m1"), extra("x1", 1), main("m2"), extra("x2", 2), main("m3")]);

    expect(layout.mains.map((ref) => [ref.mainNumber, ref.label, ref.extra])).toEqual([
      [1, "1", null],
      [2, "2", null],
      [3, "3", null],
    ]);
    expect(layout.chains.get(1)?.map((ref) => ref.mainNumber)).toEqual([1]);
  });

  it("counts an extra as canon only when every earlier extra in its chain is canon", () => {
    const layout = fanficChapterLayout([
      main("m1"),
      extra("x1", 1, true),
      extra("x2", 1, false),
      extra("x3", 1, true),
      main("m2"),
      extra("y1", 2, true),
    ]);

    expect(layout.chains.get(1)?.map((ref) => ref.extra?.canon)).toEqual([true, false, false]);
    expect(layout.chains.get(2)?.map((ref) => ref.extra?.canon)).toEqual([true]);
    expect(ids(fanficCanonLine(layout))).toEqual(["m1", "x1", "m2", "y1"]);
  });

  it("lists an extra whose chapter is gone last, outside the main chapters and chains", () => {
    const layout = fanficChapterLayout([main("m1"), extra("lost", 4, true), main("m2"), extra("x1", 1)]);

    expect(ids(layout.orphans)).toEqual(["lost"]);
    expect(layout.orphans[0]).toMatchObject({ mainNumber: 4, extra: { index: 0, canon: false } });
    expect(ids(layout.chapters)).toEqual(["m1", "x1", "m2", "lost"]);
    expect(ids(layout.mains)).toEqual(["m1", "m2"]);
    expect([...layout.chains.keys()]).toEqual([1]);
    expect(ids(fanficCanonLine(layout))).toEqual(["m1", "m2"]);
  });

  it("reads a malformed extra marker as a main chapter, and one with only a bad canon flag as a side story", () => {
    const layout = fanficChapterLayout([
      main("m1"),
      extra("zero", 0),
      extra("half", 1.5),
      extra("text", "1"),
      extra("canon-text", 1, "yes"),
      { id: "no-canon", role: "assistant", content: "None.", extra: { fanficExtra: { parentChapter: 1 } } },
      { id: "list", role: "assistant", content: "List.", extra: { fanficExtra: [1, true] } },
    ]);

    expect(labels(layout.mains)).toEqual(["1", "2", "3", "4", "5"]);
    expect(layout.chains.get(1)?.map((ref) => [ref.messageId, ref.label, ref.extra?.canon])).toEqual([
      ["canon-text", "1.5", false],
      ["no-canon", "1.6", false],
    ]);
    expect(layout.orphans).toEqual([]);
  });

  it("reads a marker stored as JSON text", () => {
    const layout = fanficChapterLayout([
      main("m1"),
      {
        id: "x1",
        role: "assistant",
        content: "X.",
        extra: JSON.stringify({ fanficExtra: { parentChapter: 1, canon: true } }),
      },
    ]);

    expect(layout.chapters.map((ref) => [ref.label, ref.extra])).toEqual([
      ["1", null],
      ["1.5", { index: 0, canon: true }],
    ]);
  });

  it("numbers a fic without extras exactly as before: assistant messages in order, headings stripped", () => {
    const messages = [
      { id: "u0", role: "user", content: "ignored" },
      main("a", "Chapter 1: Snow\n\nOne"),
      { id: "s", role: "system", content: "ignored" },
      main("b", "Two"),
      main("c", "Three"),
    ];
    const layout = fanficChapterLayout(messages);

    expect(
      layout.mains.map((ref) => ({ number: ref.mainNumber, messageId: ref.messageId, content: ref.content })),
    ).toEqual([
      { number: 1, messageId: "a", content: "One" },
      { number: 2, messageId: "b", content: "Two" },
      { number: 3, messageId: "c", content: "Three" },
    ]);
    expect(layout.chapters).toEqual(layout.mains);
    expect(fanficCanonLine(layout)).toEqual(layout.mains);
    expect(layout.chains.size).toBe(0);
  });
});

describe("fanficWriteContext", () => {
  const context = (...args: Parameters<typeof fanficWriteContext>) =>
    fanficWriteContext(...args).map((message) => message.id);

  it("gives a new main chapter every main chapter and canon extra in reading order, and no side story", () => {
    const messages = [
      main("m1"),
      main("m2"),
      extra("x1", 1, true),
      extra("x2", 1, false),
      main("m3"),
      extra("y1", 3, false),
    ];

    expect(context(messages, { kind: "main" })).toEqual(["m1", "x1", "m2", "m3"]);
  });

  it("stops an existing main chapter's context before it, keeping the canon extras of earlier chapters", () => {
    const messages = [main("m1"), extra("x1", 1, true), extra("x2", 1), main("m2"), extra("y1", 2, true), main("m3")];

    expect(context(messages, { kind: "existing", messageId: "m3" })).toEqual(["m1", "x1", "m2", "y1"]);
    expect(context(messages, { kind: "existing", messageId: "m2" })).toEqual(["m1", "x1"]);
    expect(context(messages, { kind: "existing", messageId: "m1" })).toEqual([]);
  });

  it("gives an extra the main chapters through its own, earlier canon extras and its chain so far, never a later main chapter", () => {
    const messages = [
      main("m1"),
      extra("a1", 1, true),
      extra("a2", 1),
      main("m2"),
      main("m3"),
      extra("b1", 2, true),
      extra("b2", 2),
      extra("b3", 2),
      main("m4"),
      extra("c1", 3, true),
    ];

    expect(context(messages, { kind: "extra", parentChapter: 2 })).toEqual(["m1", "a1", "m2", "b1", "b2", "b3"]);
    expect(context(messages, { kind: "existing", messageId: "b3" })).toEqual(["m1", "a1", "m2", "b1", "b2"]);
    expect(context(messages, { kind: "existing", messageId: "b1" })).toEqual(["m1", "a1", "m2"]);
    expect(context(messages, { kind: "extra", parentChapter: 4 })).toEqual(["m1", "a1", "m2", "b1", "m3", "c1", "m4"]);
  });

  it("puts an extra written after chapter 4 for chapter 3 before chapter 4 once it is canon, and leaves it out before", () => {
    const written = (canon: boolean) => [main("m1"), main("m2"), main("m3"), main("m4"), extra("x", 3, canon)];

    expect(context(written(true), { kind: "existing", messageId: "m4" })).toEqual(["m1", "m2", "m3", "x"]);
    expect(context(written(false), { kind: "existing", messageId: "m4" })).toEqual(["m1", "m2", "m3"]);
    expect(context(written(true), { kind: "main" })).toEqual(["m1", "m2", "m3", "x", "m4"]);
  });

  it("sorts a message that is not a chapter right after the main chapter stored before it, ahead of that chapter's extras", () => {
    const messages = [
      { id: "u0", role: "user", content: "Before any chapter." },
      main("m1"),
      extra("x1", 1, true),
      { id: "n1", role: "user", content: "After chapter 1." },
      main("m2"),
    ];

    expect(context(messages, { kind: "main" })).toEqual(["u0", "m1", "n1", "x1", "m2"]);
    expect(context(messages, { kind: "existing", messageId: "m2" })).toEqual(["u0", "m1", "n1", "x1"]);
    expect(context(messages, { kind: "existing", messageId: "x1" })).toEqual(["u0", "m1", "n1"]);
  });

  it("gives a fic without extras its stored messages, cut before the chapter being rewritten", () => {
    const messages = [
      { id: "u0", role: "user", content: "ignored" },
      main("a"),
      { id: "s", role: "system", content: "ignored" },
      main("b"),
      main("c"),
    ];

    expect(fanficWriteContext(messages, { kind: "main" })).toEqual(messages);
    expect(fanficWriteContext(messages, { kind: "existing", messageId: "c" })).toEqual(messages.slice(0, 4));
    expect(fanficWriteContext(messages, { kind: "existing", messageId: "b" })).toEqual(messages.slice(0, 3));
  });

  it("keeps an extra whose chapter is gone out of every context, and refuses a chapter that isn't there", () => {
    const messages = [main("m1"), extra("lost", 4, true), main("m2")];

    expect(context(messages, { kind: "main" })).toEqual(["m1", "m2"]);
    expect(() => context(messages, { kind: "existing", messageId: "lost" })).toThrow(/no longer in this fic/);
    expect(() => context(messages, { kind: "existing", messageId: "gone" })).toThrow(/no longer in this fic/);
  });
});

describe("fanficUnfinishedChapter", () => {
  const unfinished = {
    fanficVersion: { models: [], origin: { kind: "extra", notes: "" }, unfinished: { reason: "length" } },
  };

  it("finds an unfinished extra and names it by its label", () => {
    const chapter = fanficUnfinishedChapter([
      main("m1"),
      main("m2"),
      { ...extra("x1", 1), extra: { ...extra("x1", 1).extra, ...unfinished } },
    ]);

    expect(chapter?.messageId).toBe("x1");
    expect(fanficUnfinishedReason(chapter!)).toBe("Chapter 1.5 is unfinished: Reset, Continue or Keep it as is first.");
  });

  it("returns the first unfinished chapter in reading order, and never an orphan", () => {
    const unfinishedExtra = (id: string, parent: number) => ({
      ...extra(id, parent),
      extra: { ...extra(id, parent).extra, ...unfinished },
    });

    expect(
      fanficUnfinishedChapter([main("m1"), { ...main("m2"), extra: unfinished }, unfinishedExtra("x1", 1)])?.label,
    ).toBe("1.5");
    expect(fanficUnfinishedChapter([main("m1"), unfinishedExtra("lost", 3)])).toBeNull();
  });
});

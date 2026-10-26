import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficLedgerEntry } from "../../contracts/types/fanfic";
import {
  applyFanficContinuityFixes,
  applyFanficContinuityFixesToChapter,
  checkFanficChapterContinuity,
  locateFanficPassage,
  parseFanficChapterContinuityReply,
} from "./continuity";
import { fanficChapterTextKey } from "./ledger";
import { FanficQualityParseError } from "./quality";
import { createFanficState, defaultFanficRequest } from "./request";

const request = { ...defaultFanficRequest(), fandom: "The Freak Circus", characters: ["Pierrot", "Harlequin"] };

const chapterOne =
  "Pierrot cut his left hand on the knife and wrapped it in a white bandage. The rent was due on the first of June.";
const chapterTwo =
  "Harlequin found the red ball under the stage and kept it in his coat. Nobody told Pierrot where it went.";
const chapterThree =
  "Pierrot flexed both hands, neither of them hurt, and juggled five clubs. He said the rent was due on March 15.";

const handIssue = {
  category: "detail",
  subtype: "injury vanishes",
  earlierChapter: 1,
  earlierQuote: "cut his left hand on the knife and wrapped it in a white bandage",
  laterQuote: "flexed both hands, neither of them hurt",
  explanation: "The hand was cut the day before.",
  fix: { find: "flexed both hands, neither of them hurt,", replace: "flexed his good hand, the left still bandaged," },
};
const CHECKER = { connectionId: "conn-c", name: "Checker", model: "check-model" };
const rentIssue = {
  category: "timeline",
  subtype: "date changes",
  earlierChapter: 1,
  earlierQuote: "The rent was due on the first of June",
  laterQuote: "He said the rent was due on March 15",
  explanation: "The due date moved.",
  fix: { find: "the rent was due on March 15", replace: "the rent was due on the first of June" },
};

/** An extra chapter after main chapter `parentChapter`, as the writer saves it. */
function extraChapter(id: string, content: string, parentChapter: number, canon = false) {
  return { id, content, extra: { fanficExtra: { parentChapter, canon } } };
}

function storageWith(
  chapters: Array<string | { id: string; content: string; extra?: unknown }>,
  extra: { metadata?: Record<string, unknown>; connection?: Record<string, unknown> } = {},
) {
  const messages = chapters.map((chapter, index) => {
    const { id, content, ...rest } = typeof chapter === "string" ? { id: `m${index + 1}`, content: chapter } : chapter;
    return { id, role: "assistant", content, swipes: [content], ...rest } as {
      id: string;
      role: string;
      content: string;
      swipes: string[];
      [key: string]: unknown;
    };
  });
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "fanfic",
      connectionId: "conn-1",
      metadata: { fanfic: { ...createFanficState(request), outlineApproved: true }, ...extra.metadata },
    },
  };
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (records[id] ?? null) as T | null;
      if (entity === "connections" && id === "conn-1") return { id, model: "m", ...extra.connection } as T;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async updateChatIfUnchanged<T = unknown>(
      chatId: string,
      expected: { metadata: Record<string, unknown> },
      patch: { metadata: Record<string, unknown> },
    ) {
      const current = records[chatId]!.metadata as Record<string, unknown>;
      const same = Object.entries(expected.metadata).every(
        ([key, value]) => JSON.stringify(current[key] ?? null) === JSON.stringify(value),
      );
      if (same) records[chatId] = { ...records[chatId], metadata: { ...current, ...patch.metadata } };
      return { updated: same, chat: records[chatId] as T };
    },
    addChatMessageSwipe: vi.fn(async (_chatId: string, messageId: string, content: string) => {
      const message = messages.find((entry) => entry.id === messageId)!;
      message.swipes.push(content);
      message.content = content;
      return message;
    }),
  } as unknown as StorageGateway & { addChatMessageSwipe: ReturnType<typeof vi.fn> };
  return { storage, messages };
}

/** Routes by system prompt: each sweep returns its own issues, the double-check confirms the notes it's told to. */
function judgeLlm(
  sweeps: { timeline?: unknown[]; detail?: unknown[] },
  confirm: (note: number) => boolean = () => true,
) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const system = request.messages[0]!.content;
      if (system.startsWith("You double-check")) {
        const count = (system.match(/^\d+\. /gm) ?? []).length;
        return JSON.stringify({
          verdicts: Array.from({ length: count }, (_, index) => ({
            note: index + 1,
            reason: "Checked.",
            contradiction: confirm(index + 1),
            sameAs: null,
          })),
        });
      }
      const issues = system.includes("- timeline (") ? (sweeps.timeline ?? []) : (sweeps.detail ?? []);
      return JSON.stringify({ issues });
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("fanfic chapter continuity parsing", () => {
  it("pins every issue to the checked chapter and keeps a usable fix", () => {
    const [issue] = parseFanficChapterContinuityReply(
      JSON.stringify({ issues: [{ ...handIssue, laterChapter: 9 }] }),
      3,
    );
    expect(issue).toMatchObject({ laterChapter: 3, earlierChapter: 1, fix: handIssue.fix });
  });

  it("drops a fix that changes nothing and treats a broken entry as a bad reply", () => {
    const [issue] = parseFanficChapterContinuityReply(
      JSON.stringify({ issues: [{ ...handIssue, fix: { find: "same", replace: "same" } }] }),
      3,
    );
    expect(issue!.fix).toBeNull();
    expect(() => parseFanficChapterContinuityReply(JSON.stringify({ issues: [{ category: "detail" }] }), 3)).toThrow(
      FanficQualityParseError,
    );
  });
});

describe("fanfic continuity fixes", () => {
  it("matches whole words only, so a fix never lands inside a longer word", () => {
    const text = "Bathe left the room at noon. Later, the left the room joke landed.";
    // "he left the room" only occurs inside "Bathe left the room" and "the left the room".
    expect(locateFanficPassage(text, "he left the room")).toBeNull();
    expect(locateFanficPassage("She said he left the room early.", "he left the room")).toMatchObject({ start: 9 });
    // Contractions and accented letters are inside the word.
    expect(locateFanficPassage("Then he's gone.", "Then he")).toBeNull();
    expect(locateFanficPassage("She drank her café slowly that night.", "drank her caf")).toBeNull();
    expect(locateFanficPassage("She drank her café slowly that night.", "her café slowly")).toMatchObject({
      start: 10,
    });
    expect(locateFanficPassage("Then he’s gone, and then he left.", "he’s gone, and")).toMatchObject({ start: 5 });
    // Letters outside the basic plane (surrogate pairs) are word characters too.
    expect(locateFanficPassage("𝔸he left the hall.", "he left the")).toBeNull();
    expect(locateFanficPassage("The 𠮷𠮷 left the hall.", "𠮷 left the")).toBeNull();
    // An accent typed as its own combining mark is part of the word.
    expect(locateFanficPassage("A caféhe left the hall.", "he left the")).toBeNull();
    // The exact-text path checks word edges too.
    expect(locateFanficPassage("Bathe left the room.", "athe left the room")).toBeNull();
    expect(locateFanficPassage("Then he left the room.", "he left the room.")).toMatchObject({ start: 5 });
    // A near match elsewhere doesn't make the exact one ambiguous.
    expect(locateFanficPassage("Theo left the room. Then he left the room.", "he left the room")).toMatchObject({
      start: 25,
    });
  });

  it("finds a passage through curly quotes, italics, and line breaks, but only when it occurs once", () => {
    const text = "He said, “I don’t *know*,\nreally.” Then he left. Then he left.";
    expect(locateFanficPassage(text, 'He said, "I don\'t know, really."')).toMatchObject({ start: 0 });
    expect(locateFanficPassage(text, "Then he left.")).toBeNull();
    expect(locateFanficPassage(text, "nowhere in this text")).toBeNull();
  });

  it("applies fixes in order and skips one whose passage was already rewritten", () => {
    const result = applyFanficContinuityFixes(chapterThree, [
      handIssue.fix,
      rentIssue.fix,
      { find: "neither of them hurt, and juggled", replace: "x" },
    ]);
    expect(result).toMatchObject({ applied: 2, skipped: 1, appliedIndexes: [0, 1] });
    expect(result.text).toBe(
      "Pierrot flexed his good hand, the left still bandaged, and juggled five clubs. He said the rent was due on the first of June.",
    );
  });

  it("saves the fixed chapter as a new version, and refuses if the chapter changed since the check", async () => {
    const { storage, messages } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const check = { messageId: "m3", textKey: fanficChapterTextKey(chapterThree), model: CHECKER };

    const saved = await applyFanficContinuityFixesToChapter(storage, {
      chatId: "chat-1",
      check,
      fixes: [rentIssue.fix],
    });
    expect(saved).toEqual({
      applied: 1,
      skipped: 0,
      appliedIndexes: [0],
      textKey: fanficChapterTextKey(messages[2]!.content as string),
    });
    expect(messages[2]!.swipes).toHaveLength(2);
    expect(messages[2]!.content).toContain("the first of June");

    await expect(
      applyFanficContinuityFixesToChapter(storage, { chatId: "chat-1", check, fixes: [handIssue.fix] }),
    ).rejects.toThrow(/changed since the check/);
  });

  it("saves the fixes as a version written by the chapter's models and then the model that wrote the fixes", async () => {
    const { storage, messages } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const writer = { connectionId: "conn-w", name: "Writer", model: "big-model" };
    Object.assign(messages[2]!, {
      activeSwipeIndex: 0,
      extra: { fanficVersion: { models: [writer], origin: { kind: "chapter", notes: "" }, unfinished: null } },
    });
    const check = { messageId: "m3", textKey: fanficChapterTextKey(chapterThree), model: CHECKER };

    await applyFanficContinuityFixesToChapter(storage, { chatId: "chat-1", check, fixes: [rentIssue.fix] });

    expect(storage.addChatMessageSwipe.mock.calls[0]?.[3]).toEqual({
      activate: true,
      extra: {
        fanficVersion: {
          models: [writer, CHECKER],
          origin: { kind: "revise", notes: "", baseVersion: 0 },
          unfinished: null,
        },
      },
    });
  });
});

describe("checkFanficChapterContinuity", () => {
  it("names the model that ran the check, so the fixes it wrote can be credited to it", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree], { connection: { name: "Checker" } });
    const { llm } = judgeLlm({ timeline: [rentIssue] });

    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m3" });

    expect(check.model).toEqual({ connectionId: "conn-1", name: "Checker", model: "m" });
  });

  it("reads every earlier chapter, grounds the quotes, and returns confirmed slips with their fixes", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const { llm, requests } = judgeLlm({ timeline: [rentIssue], detail: [handIssue] });
    const phases: string[] = [];

    const check = await checkFanficChapterContinuity(
      { storage, llm },
      { chatId: "chat-1", messageId: "m3" },
      { onPhase: (phase) => phases.push(phase) },
    );

    expect(requests).toHaveLength(3);
    const user = requests[0]!.messages[1]!.content;
    expect(user).toContain("### Chapter 1\n");
    expect(user).toContain("## Chapter 3 (the chapter to check)");
    expect(requests[0]!.messages[0]!.content).not.toMatch(/<[a-z]+>/);
    expect(check).toMatchObject({
      chapter: 3,
      label: "3",
      basis: "chapters",
      chaptersRead: ["1", "2"],
      candidates: 2,
      ungrounded: 0,
    });
    expect(check.issues.map((issue) => issue.subtype).sort()).toEqual(["date changes", "injury vanishes"]);
    expect(check.issues.every((issue) => issue.fix)).toBe(true);
    expect(phases).toEqual(["checking", "verifying"]);
  });

  it("drops invented quotes and fixes it can't place, and counts what the second read rejected", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const invented = { ...handIssue, earlierQuote: "Pierrot lost three fingers in the fire last spring" };
    const unplaced = { ...rentIssue, fix: { find: "a sentence that isn't there at all", replace: "y" } };
    const { llm } = judgeLlm(
      { timeline: [unplaced], detail: [invented, { ...handIssue, subtype: "hand again" }] },
      () => false,
    );

    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m3" });

    expect(check).toMatchObject({ candidates: 3, ungrounded: 1, rejected: 2, issues: [] });
  });

  it("keeps the fix a repeated note brought when the note kept had none", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const { llm } = judgeLlm({ detail: [{ ...handIssue, fix: null }, handIssue] });

    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m3" });

    expect(check.issues).toHaveLength(1);
    expect(check.issues[0]!.fix).toEqual(handIssue.fix);
    expect(check.merged).toBe(1);
  });

  it("finishes without a second read when nothing survives grounding", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree]);
    const { llm, requests } = judgeLlm({});

    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m3" });

    expect(requests).toHaveLength(2);
    expect(check.issues).toEqual([]);
  });

  it("stands the ledger in for the oldest chapters when they don't fit the window", async () => {
    const long = (text: string) => `${text} ${"filler ".repeat(1400)}`;
    const chapters = [long(chapterOne), long(chapterTwo), long("Day three began."), chapterThree];
    const entry = (chapter: number): FanficLedgerEntry => ({
      chapter,
      messageId: `m${chapter}`,
      textKey: fanficChapterTextKey(chapters[chapter - 1]!),
      summary: `Summary ${chapter}.`,
      timeline: `Day ${chapter}`,
      knowledge: [],
      conditions: [{ subject: "Pierrot", detail: "Left hand cut and bandaged since day 1." }],
      relationships: [],
      openThreads: [],
    });
    const { storage } = storageWith(chapters, {
      metadata: { fanficLedger: { version: 1, entries: [entry(1), entry(2), entry(3)] } },
      connection: { maxContext: 12000 },
    });
    const fromLedger = { ...handIssue, earlierChapter: 0, earlierQuote: "Left hand cut and bandaged since day 1" };
    const { llm, requests } = judgeLlm({ detail: [fromLedger] });

    const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m4" });

    const user = requests[0]!.messages[1]!.content;
    expect(user).toContain("## Story ledger through chapter 2");
    expect(user).not.toContain("### Chapter 1\n");
    expect(user).not.toContain("### Chapter 2\n");
    expect(user).toContain("### Chapter 3\n");
    expect(check).toMatchObject({ basis: "ledger", chaptersRead: ["3"] });
    expect(check.issues[0]).toMatchObject({ earlierChapter: 0 });
  });

  it("refuses a window too small for the instructions and the chapter, before calling the model", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo, chapterThree], { connection: { maxContext: 1500 } });
    const { llm, requests } = judgeLlm({});
    await expect(checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m3" })).rejects.toThrow(
      /context window is too small for checking chapter 3/,
    );
    expect(requests).toHaveLength(0);
  });

  describe("with extra chapters", () => {
    const sideStory = "A side story where Pierrot dreams of the sea and the gulls.";
    const reminder = "The rent was due on the first of June, Harlequin reminded him.";
    const chapterFour = "The troupe left town at dawn with every wagon loaded.";
    // Stored in writing order: 1.5 and 3.5 before chapter 4, and 3.6 after it.
    const fic = (canon35 = false) => [
      chapterOne,
      chapterTwo,
      "Pierrot slept through most of the third day.",
      extraChapter("x15", sideStory, 1),
      extraChapter("x35", reminder, 3, canon35),
      { id: "m4", content: chapterFour, extra: {} },
      extraChapter("x36", chapterThree, 3),
    ];

    it("checks an extra against its own write context, never later main chapters or other side stories", async () => {
      const { storage } = storageWith(fic());
      const { llm, requests } = judgeLlm({});

      const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "x36" });

      const user = requests[0]!.messages[1]!.content;
      for (const label of ["1", "2", "3", "3.5"]) expect(user).toContain(`### Chapter ${label}\n`);
      expect(user).toContain("## Chapter 3.6 (the chapter to check)");
      expect(user).not.toContain(chapterFour);
      expect(user).not.toContain(sideStory);
      expect(requests[0]!.messages[0]!.content).toContain("checking chapter 3.6 of a fic");
      expect(check).toMatchObject({ messageId: "x36", label: "3.6", chaptersRead: ["1", "2", "3", "3.5"] });
    });

    it("never shows a main chapter's check a side story, and shows it a canon extra", async () => {
      const side = judgeLlm({});
      await checkFanficChapterContinuity(
        { storage: storageWith(fic()).storage, llm: side.llm },
        { chatId: "chat-1", messageId: "m4" },
      );
      const user = side.requests[0]!.messages[1]!.content;
      expect(user).not.toContain(reminder);
      expect(user).not.toContain(sideStory);
      expect(user).not.toContain("### Chapter 3.5");
      expect(user).toContain("## Chapter 4 (the chapter to check)");

      const canon = judgeLlm({});
      const check = await checkFanficChapterContinuity(
        { storage: storageWith(fic(true)).storage, llm: canon.llm },
        { chatId: "chat-1", messageId: "m4" },
      );
      expect(canon.requests[0]!.messages[1]!.content).toContain(`### Chapter 3.5\n\n${reminder}`);
      expect(check.chaptersRead).toEqual(["1", "2", "3", "3.5"]);
    });

    it("stores the message ids of both chapters on each issue and reads a label the judge names", async () => {
      // The earlier quote is in chapter 1 and in 3.5; the judge's own choice decides which.
      const named = judgeLlm({ timeline: [{ ...rentIssue, earlierChapter: "3.5" }] });
      const check = await checkFanficChapterContinuity(
        { storage: storageWith(fic()).storage, llm: named.llm },
        { chatId: "chat-1", messageId: "x36" },
      );
      expect(check.issues[0]).toMatchObject({
        earlierChapter: 3,
        earlierMessageId: "x35",
        laterChapter: 3,
        laterMessageId: "x36",
      });
      const verify = named.requests.find((request) => request.messages[0]!.content.startsWith("You double-check"))!;
      expect(verify.messages[0]!.content).toContain(
        '1. Chapter 3.5: "The rent was due on the first of June" vs chapter 3.6',
      );

      const first = judgeLlm({ timeline: [rentIssue] });
      const fromOne = await checkFanficChapterContinuity(
        { storage: storageWith(fic()).storage, llm: first.llm },
        { chatId: "chat-1", messageId: "x36" },
      );
      expect(fromOne.issues[0]).toMatchObject({ earlierChapter: 1, earlierMessageId: "m1" });
    });

    it("finds a chapter the judge names by a label it invented by its quote, and drops it when the quote is nowhere", async () => {
      const invented = judgeLlm({
        timeline: [
          { ...rentIssue, earlierChapter: "3.7", earlierQuote: "the first of June, Harlequin reminded him" },
          { ...rentIssue, subtype: "made up", earlierChapter: "3.7", earlierQuote: "a line nobody ever wrote down" },
        ],
      });
      const check = await checkFanficChapterContinuity(
        { storage: storageWith(fic()).storage, llm: invented.llm },
        { chatId: "chat-1", messageId: "x36" },
      );

      expect(check.issues).toHaveLength(1);
      expect(check.issues[0]).toMatchObject({ earlierChapter: 3, earlierMessageId: "x35" });
      expect(check.ungrounded).toBe(1);
    });

    it("reads an extra's chain in full beside the ledger when the main chapters before it don't fit", async () => {
      const long = (text: string) => `${text} ${"filler ".repeat(1400)}`;
      const mains = [long(chapterOne), long(chapterTwo), long("Day three began.")];
      const entry = (chapter: number): FanficLedgerEntry => ({
        chapter,
        messageId: `m${chapter}`,
        textKey: fanficChapterTextKey(mains[chapter - 1]!),
        summary: `Summary ${chapter}.`,
        timeline: `Day ${chapter}`,
        knowledge: [],
        conditions: [{ subject: "Pierrot", detail: "Left hand cut and bandaged since day 1." }],
        relationships: [],
        openThreads: [],
      });
      const { storage } = storageWith(
        [
          ...mains,
          extraChapter("x35", sideStory, 3),
          extraChapter("x36", reminder, 3),
          extraChapter("x37", chapterThree, 3),
        ],
        {
          metadata: { fanficLedger: { version: 1, entries: [entry(1), entry(2), entry(3)] } },
          connection: { maxContext: 12000 },
        },
      );
      const { llm, requests } = judgeLlm({ timeline: [{ ...rentIssue, earlierChapter: "3.6" }] });

      const check = await checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "x37" });

      const user = requests[0]!.messages[1]!.content;
      expect(user).toContain("## Story ledger through chapter 3");
      expect(user).toContain(`### Chapter 3.5\n\n${sideStory}`);
      expect(user).toContain(`### Chapter 3.6\n\n${reminder}`);
      expect(check).toMatchObject({ basis: "ledger", chaptersRead: ["3.5", "3.6"] });
      expect(check.issues[0]).toMatchObject({ earlierMessageId: "x36" });
    });

    it("applies fixes to an extra chapter", async () => {
      const { storage, messages } = storageWith(fic());
      const check = { messageId: "x36", textKey: fanficChapterTextKey(chapterThree), model: CHECKER };

      await applyFanficContinuityFixesToChapter(storage, { chatId: "chat-1", check, fixes: [rentIssue.fix] });

      expect(messages.find((message) => message.id === "x36")!.content).toContain("the first of June");
    });
  });

  it("refuses chapter 1 and chats that aren't fanfic", async () => {
    const { storage } = storageWith([chapterOne, chapterTwo]);
    const { llm } = judgeLlm({});
    await expect(checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "m1" })).rejects.toThrow(
      /nothing before it/,
    );
    await expect(
      checkFanficChapterContinuity({ storage, llm }, { chatId: "chat-1", messageId: "gone" }),
    ).rejects.toThrow(/no longer in this fic/);
  });
});

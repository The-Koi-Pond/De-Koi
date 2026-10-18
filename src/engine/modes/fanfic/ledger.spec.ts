import { fanficCallBudget } from "./llm-json";
import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficLedger, FanficLedgerEntry } from "../../contracts/types/fanfic";
import { fanficChapterRefs } from "./chapter-refs";
import {
  buildFanficLedgerMessages,
  fanficChapterTextKey,
  fanficLedgerStatus,
  FanficLedgerParseError,
  parseFanficLedgerReply,
  planFanficLedgerCalls,
  readFanficLedger,
  renderFanficLedgerForPrompt,
  updateFanficLedger,
} from "./ledger";
import { createFanficState, defaultFanficRequest } from "./request";

const request = {
  ...defaultFanficRequest(),
  fandom: "The Freak Circus",
  characters: ["Pierrot", "Harlequin"],
  prompt: "Pierrot learns to share.",
  styleNotes: "Lush and filthy.",
};

const chapterTexts = [
  "Pierrot cut his left hand on the knife and bandaged it. Harlequin hid the red ball under the stage.",
  "The next night Pierrot juggled one-handed. Harlequin told him where the red ball was.",
  "On the third day the bandage came off.",
];

function draft(chapter: number, extra: Partial<FanficLedgerEntry> = {}) {
  return {
    chapter,
    summary: `Chapter ${chapter} happens.`,
    timeline: `Day ${chapter}`,
    knowledge: [{ subject: "Red ball", detail: "Only Harlequin knows where it is." }],
    conditions: [{ subject: "Pierrot", detail: "Left hand bandaged." }],
    relationships: [{ subject: "Pierrot & Harlequin", detail: "Wary truce." }],
    openThreads: ["Where the red ball is."],
    ...extra,
  };
}

function reply(chapters: number[]): string {
  return `\`\`\`json\n${JSON.stringify({ entries: chapters.map((chapter) => draft(chapter)) })}\n\`\`\``;
}

function entryFor(chapter: number, text = chapterTexts[chapter - 1]!): FanficLedgerEntry {
  return { ...draft(chapter), messageId: `m${chapter}`, textKey: fanficChapterTextKey(text) };
}

function messages(texts: string[]) {
  return [
    { id: "u0", role: "user", content: "ignored" },
    ...texts.map((content, index) => ({ id: `m${index + 1}`, role: "assistant", content })),
  ];
}

function storageWith(
  texts: string[],
  metadata: Record<string, unknown> = {},
  connection: Record<string, unknown> = {},
) {
  let chapters = texts;
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "fanfic",
      connectionId: "conn-1",
      metadata: { fanfic: { ...createFanficState(request), outlineApproved: true }, ...metadata },
    },
  };
  let beforeWrite: (() => void) | undefined;
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (records[id] ?? null) as T | null;
      if (entity === "connections" && id === "conn-1") return { id, model: "test-model", ...connection } as T;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages(chapters) as T[];
    },
    async updateChatIfUnchanged<T = unknown>(
      chatId: string,
      expected: { metadata: Record<string, unknown> },
      patch: { metadata: Record<string, unknown> },
    ): Promise<{ updated: boolean; chat: T }> {
      beforeWrite?.();
      const current = records[chatId]!.metadata as Record<string, unknown>;
      const same = Object.entries(expected.metadata).every(
        ([key, value]) => JSON.stringify(current[key] ?? null) === JSON.stringify(value),
      );
      if (same) records[chatId] = { ...records[chatId], metadata: { ...current, ...patch.metadata } };
      return { updated: same, chat: records[chatId] as T };
    },
  } as unknown as StorageGateway;
  return {
    storage,
    records,
    ledger: () => (records["chat-1"]!.metadata as Record<string, unknown>).fanficLedger as FanficLedger,
    setChapters(next: string[]) {
      chapters = next;
    },
    interfere(write: () => void) {
      beforeWrite = () => {
        beforeWrite = undefined;
        write();
      };
    },
  };
}

/** Answers each ledger request with entries for the chapters it was shown. */
function ledgerLlm(override?: (request: LlmRequest, index: number) => string | undefined) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const custom = override?.(request, requests.length - 1);
      if (custom !== undefined) return custom;
      const user = request.messages.at(-1)?.content ?? "";
      const shown = [...user.matchAll(/^## Chapter (\d+)$/gm)].map((match) => Number(match[1]));
      return reply(shown);
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("fanfic ledger parsing", () => {
  it("reads one entry per chapter and caps the lists", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ subject: `S${index}`, detail: "d" }));
    const raw = JSON.stringify({ entries: [draft(1, { knowledge: many }), draft(2)] });
    const entries = parseFanficLedgerReply(raw, [1, 2]);
    expect(entries.map((entry) => entry.chapter)).toEqual([1, 2]);
    expect(entries[0]!.knowledge).toHaveLength(12);
    expect(entries[1]!.conditions).toEqual([{ subject: "Pierrot", detail: "Left hand bandaged." }]);
  });

  it("numbers entries by the chapters asked for, not the reply's own numbers", () => {
    const entries = parseFanficLedgerReply(JSON.stringify({ entries: [draft(7)] }), [3]);
    expect(entries[0]!.chapter).toBe(3);
  });

  it("accepts who/knows and between/stage keys", () => {
    const raw = JSON.stringify({
      entries: [
        draft(1, {
          knowledge: [{ who: "Harlequin", knows: "Where the ball is." }] as never,
          relationships: [{ between: "P & H", stage: "Truce" }] as never,
        }),
      ],
    });
    const [entry] = parseFanficLedgerReply(raw, [1]);
    expect(entry!.knowledge).toEqual([{ subject: "Harlequin", detail: "Where the ball is." }]);
    expect(entry!.relationships).toEqual([{ subject: "P & H", detail: "Truce" }]);
  });

  it("rejects a missing entry, a missing summary, or a list that isn't one", () => {
    expect(() => parseFanficLedgerReply(reply([1]), [1, 2])).toThrow(FanficLedgerParseError);
    expect(() => parseFanficLedgerReply(JSON.stringify({ entries: [draft(1, { summary: "" })] }), [1])).toThrow(
      FanficLedgerParseError,
    );
    expect(() =>
      parseFanficLedgerReply(JSON.stringify({ entries: [draft(1, { conditions: "hurt" as never })] }), [1]),
    ).toThrow(FanficLedgerParseError);
    expect(() => parseFanficLedgerReply("Sorry, I can't.", [1])).toThrow(FanficLedgerParseError);
  });
});

describe("fanfic ledger freshness", () => {
  const refs = fanficChapterRefs(messages(chapterTexts));

  it("is fresh while every chapter keeps its message and text", () => {
    const ledger: FanficLedger = { version: 1, entries: [entryFor(1), entryFor(2), entryFor(3)] };
    expect(fanficLedgerStatus(ledger, refs)).toMatchObject({ stale: [] });
  });

  it("goes stale from a rewritten chapter onward, since each entry builds on the last", () => {
    const ledger: FanficLedger = {
      version: 1,
      entries: [entryFor(1), entryFor(2, "an older version of chapter 2"), entryFor(3)],
    };
    const status = fanficLedgerStatus(ledger, refs);
    expect(status.fresh.map((entry) => entry.chapter)).toEqual([1]);
    expect(status.stale).toEqual([2, 3]);
  });

  it("ignores ledgers from another version and stops at an out-of-order entry", () => {
    expect(readFanficLedger({ fanficLedger: { version: 99, entries: [entryFor(1)] } }).entries).toEqual([]);
    expect(
      readFanficLedger({ fanficLedger: { version: 1, entries: [entryFor(1), entryFor(3)] } }).entries.map(
        (entry) => entry.chapter,
      ),
    ).toEqual([1]);
    expect(
      readFanficLedger(JSON.stringify({ fanficLedger: { version: 1, entries: [entryFor(1)] } })).entries,
    ).toHaveLength(1);
  });

  it("splits a backfill by chapter count and by prose budget", () => {
    const long = Array.from({ length: 8 }, (_, index) => ({
      number: index + 1,
      messageId: `m${index}`,
      content: "x".repeat(10),
    }));
    expect(planFanficLedgerCalls(long, 1_000).map((call) => call.length)).toEqual([6, 2]);
    expect(planFanficLedgerCalls(long, 25).map((call) => call.length)).toEqual([2, 2, 2, 2]);
    // A chapter bigger than the budget still goes, alone.
    expect(planFanficLedgerCalls([{ number: 1, messageId: "m", content: "x".repeat(50) }], 10)).toHaveLength(1);
  });
});

describe("fanfic ledger prompt", () => {
  it("asks for entries that build on the previous one, without the style notes", () => {
    const [system, user] = buildFanficLedgerMessages({
      request,
      previous: entryFor(1),
      chapters: fanficChapterRefs(messages(chapterTexts)).slice(1),
    });
    expect(system!.content).toContain("## Ledger after chapter 1");
    expect(system!.content).toContain("- Pierrot: Left hand bandaged.");
    expect(system!.content).not.toContain("Lush and filthy.");
    expect(system!.content).not.toMatch(/<[a-z]+>/);
    expect(user!.content).toContain("## Chapter 2\n");
    expect(user!.content).toContain("one ledger entry for each of chapters 2 to 3");
  });

  it("renders the latest fresh entry and a line per chapter for the chapter prompt", () => {
    const refs = fanficChapterRefs(messages(chapterTexts));
    const ledger: FanficLedger = { version: 1, entries: [entryFor(1), entryFor(2)] };
    const block = renderFanficLedgerForPrompt(ledger, refs);
    expect(block).toContain("## Story ledger");
    expect(block).toContain("### Where things stand after chapter 2");
    expect(block).toContain("Chapter 1: Chapter 1 happens.\nChapter 2: Chapter 2 happens.");
    expect(block).toContain("runs through chapter 2; where a later chapter says otherwise, the chapter wins");
    expect(renderFanficLedgerForPrompt({ version: 1, entries: [] }, refs)).toBe("");
  });
});

describe("updateFanficLedger", () => {
  it("backfills a fic in as few calls as fit and saves the entries with their fingerprints", async () => {
    const { storage, ledger } = storageWith(chapterTexts);
    const { llm, requests } = ledgerLlm();
    const progress: number[] = [];

    const result = await updateFanficLedger(
      { storage, llm },
      { chatId: "chat-1" },
      { onProgress: ({ done }) => progress.push(done) },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.parameters).toMatchObject({ temperature: 0 });
    expect(result.entries.map((entry) => [entry.chapter, entry.messageId])).toEqual([
      [1, "m1"],
      [2, "m2"],
      [3, "m3"],
    ]);
    expect(ledger().entries[2]!.textKey).toBe(fanficChapterTextKey(chapterTexts[2]!));
    expect(progress).toEqual([0, 3]);
  });

  it("reads only the chapters after the last fresh entry", async () => {
    const { storage } = storageWith(chapterTexts, {
      fanficLedger: { version: 1, entries: [entryFor(1), entryFor(2, "old chapter 2"), entryFor(3)] },
    });
    const { llm, requests } = ledgerLlm();

    await updateFanficLedger({ storage, llm }, { chatId: "chat-1" });

    const user = requests[0]!.messages.at(-1)!.content;
    expect(user).not.toContain("## Chapter 1\n");
    expect(user).toContain("## Chapter 2\n");
    expect(requests[0]!.messages[0]!.content).toContain("## Ledger after chapter 1");
  });

  it("makes no call when the ledger is current, and trims entries for a deleted chapter", async () => {
    const { storage, ledger } = storageWith(chapterTexts.slice(0, 2), {
      fanficLedger: { version: 1, entries: [entryFor(1), entryFor(2), entryFor(3)] },
    });
    const { llm, requests } = ledgerLlm();

    await updateFanficLedger({ storage, llm }, { chatId: "chat-1" });

    expect(requests).toHaveLength(0);
    expect(ledger().entries.map((entry) => entry.chapter)).toEqual([1, 2]);
  });

  it("splits a backfill when the connection's window is small", async () => {
    const big = chapterTexts.map((text) => `${text} ${"word ".repeat(1200)}`);
    const { storage } = storageWith(big, {}, { maxContext: 4000 });
    const { llm, requests } = ledgerLlm();

    await updateFanficLedger({ storage, llm }, { chatId: "chat-1" });

    expect(requests.length).toBeGreaterThan(1);
    expect(requests[1]!.messages[0]!.content).toMatch(/## Ledger after chapter \d/);
  });

  it("retries a reply that breaks the format once, then gives up instead of saving a partial ledger", async () => {
    const { storage, ledger } = storageWith(chapterTexts);
    const retried = ledgerLlm((_, index) => (index === 0 ? "not json" : undefined));
    await updateFanficLedger({ storage, llm: retried.llm }, { chatId: "chat-1" });
    expect(retried.requests).toHaveLength(2);
    expect(ledger().entries).toHaveLength(3);

    const broken = storageWith(chapterTexts);
    const failing = ledgerLlm(() => reply([1]));
    await expect(
      updateFanficLedger({ storage: broken.storage, llm: failing.llm }, { chatId: "chat-1" }),
    ).rejects.toThrow(FanficLedgerParseError);
    expect(broken.ledger()).toBeUndefined();
  });

  it("starts over from another tab's entries instead of overwriting them", async () => {
    const harness = storageWith(chapterTexts);
    const { llm, requests } = ledgerLlm();
    harness.interfere(() => {
      const metadata = harness.records["chat-1"]!.metadata as Record<string, unknown>;
      metadata.fanficLedger = {
        version: 1,
        entries: [entryFor(1), entryFor(2), { ...entryFor(3), summary: "Theirs." }],
      };
    });

    const result = await updateFanficLedger({ storage: harness.storage, llm }, { chatId: "chat-1" });

    expect(requests).toHaveLength(1);
    expect(result.entries[2]!.summary).toBe("Theirs.");
    expect(harness.ledger().entries[2]!.summary).toBe("Theirs.");
  });

  it("stops on abort without saving the late reply", async () => {
    const { storage, ledger } = storageWith(chapterTexts);
    const controller = new AbortController();
    let release: (value: string) => void = () => {};
    const llm = {
      complete: vi.fn(() => new Promise<string>((resolve) => (release = resolve))),
    } as unknown as LlmGateway;

    const update = updateFanficLedger({ storage, llm }, { chatId: "chat-1" }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release(reply([1, 2, 3]));

    await expect(update).rejects.toMatchObject({ name: "AbortError" });
    expect(ledger()).toBeUndefined();
  });

  it("skips the quiet after-chapter update until the ledger is in use", async () => {
    const roomy = storageWith(chapterTexts, {}, { maxContext: 200_000 });
    const idle = ledgerLlm();
    await updateFanficLedger({ storage: roomy.storage, llm: idle.llm }, { chatId: "chat-1", onlyIfInUse: true });
    expect(idle.requests).toHaveLength(0);
    expect(roomy.ledger()).toBeUndefined();

    // Chapters filling half the window: the oldest will soon drop out of the prompt.
    const long = chapterTexts.map((text) => `${text} ${"word ".repeat(1200)}`);
    const tight = storageWith(long, {}, { maxContext: 8_000 });
    const busy = ledgerLlm();
    await updateFanficLedger({ storage: tight.storage, llm: busy.llm }, { chatId: "chat-1", onlyIfInUse: true });
    expect(tight.ledger().entries).toHaveLength(3);

    // Once a ledger exists, it's kept current whatever the window.
    const started = storageWith(
      chapterTexts,
      { fanficLedger: { version: 1, entries: [entryFor(1)] } },
      { maxContext: 200_000 },
    );
    const kept = ledgerLlm();
    await updateFanficLedger({ storage: started.storage, llm: kept.llm }, { chatId: "chat-1", onlyIfInUse: true });
    expect(started.ledger().entries).toHaveLength(3);
  });

  it("refuses chats that aren't fanfic and fics with no connection", async () => {
    const { storage, records } = storageWith(chapterTexts);
    const { llm } = ledgerLlm();
    records["chat-1"]!.connectionId = "random";
    await expect(updateFanficLedger({ storage, llm }, { chatId: "chat-1" })).rejects.toThrow(/Pick a connection/);
    records["chat-1"]!.mode = "roleplay";
    await expect(updateFanficLedger({ storage, llm }, { chatId: "chat-1" })).rejects.toThrow(/only kept for fanfic/);
  });
});

describe("fanficCallBudget", () => {
  const base = { maxReplyTokens: 8000, defaultChars: 100_000, what: "the story ledger" };
  it("measures the fixed prompt, caps the reply to what is left, and refuses windows that cannot fit", () => {
    // 9,000 fixed characters is 3,000 tokens; a 4,000-token window leaves 1,000: all of it reply, no prose.
    expect(fanficCallBudget(4000, { ...base, fixedChars: 9000 })).toEqual({ replyTokens: 1000, proseChars: 0 });
    // A 3,000-token window is used up by the fixed text alone.
    expect(() => fanficCallBudget(3000, { ...base, fixedChars: 9000 })).toThrow(
      /context window is too small for the story ledger/,
    );
    expect(fanficCallBudget(200_000, { ...base, fixedChars: 9000, maxChars: 100_000 })).toEqual({
      replyTokens: 8000,
      proseChars: 100_000,
    });
    expect(fanficCallBudget(0, { ...base, fixedChars: 9000 })).toEqual({ replyTokens: 8000, proseChars: 100_000 });
  });
});

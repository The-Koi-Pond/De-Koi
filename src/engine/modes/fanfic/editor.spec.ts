import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficState } from "../../contracts/types/fanfic";
import {
  locateFanficScene,
  parseFanficEditorReply,
  readFanficEditorStore,
  rewriteFanficFlaggedScenes,
  runFanficEditorPass,
  type FanficEditorReport,
} from "./editor";
import { fanficChapterTextKey } from "./ledger";
import { buildFanficPassageRewriteMessages, cleanFanficPassageReply, loadFanficChapterForEdit } from "./passage";
import { createFanficState, defaultFanficRequest } from "./request";

const request = { ...defaultFanficRequest(), fandom: "The Freak Circus", characters: ["Pierrot", "Harlequin"] };

const chapterOne =
  "Pierrot set the table for two. Harlequin came late and sat anyway. Nobody said a word about the knife.";
const chapterTwo =
  "The rain kept on all morning and the tent leaked in three places. Pierrot explained to Harlequin that he felt sad and that sadness is when you feel bad. Harlequin nodded and agreed that it was sad. Then the show began on time.";

const scores = (value: number) => ({
  escalation: value,
  subplot: value,
  choices: value,
  theme: value,
  exposition: value,
});
const notes = { escalation: "e", subplot: "s", choices: "c", theme: "t", exposition: "x" };

/** A side story after main chapter 1, as the writer saves it. */
const sideStory = (content: string) => ({
  id: "x1",
  content,
  extra: { fanficExtra: { parentChapter: 1, canon: false } },
});

function storageWith(chapters: Array<string | ReturnType<typeof sideStory>>) {
  const chat: Record<string, unknown> = {
    id: "chat-1",
    mode: "fanfic",
    connectionId: "conn-1",
    metadata: { fanfic: createFanficState(request) satisfies FanficState },
  };
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
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === "chat-1") return chat as T;
      if (entity === "connections")
        return { id, provider: "claude_subscription", name: "Editor", model: "edit-model" } as T;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return messages as T[];
    },
    async updateChatIfUnchanged(
      _id: string,
      expected: { metadata: Record<string, unknown> },
      patch: { metadata: Record<string, unknown> },
    ) {
      const metadata = chat.metadata as Record<string, unknown>;
      const same = Object.entries(expected.metadata).every(
        ([key, value]) => JSON.stringify(metadata[key] ?? null) === JSON.stringify(value),
      );
      if (same) chat.metadata = { ...metadata, ...patch.metadata };
      return { updated: same, chat };
    },
    addChatMessageSwipe: vi.fn(async (_chatId: string, messageId: string, content: string) => {
      const message = messages.find((entry) => entry.id === messageId)!;
      message.swipes.push(content);
      message.content = content;
      return message;
    }),
  } as unknown as StorageGateway & { addChatMessageSwipe: ReturnType<typeof vi.fn> };
  return { storage, chat, messages };
}

function scriptedLlm(reply: (request: LlmRequest) => string) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      return reply(llmRequest);
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("parseFanficEditorReply", () => {
  const chapter = { messageId: "m2", content: chapterTwo, label: "2", mainNumber: 2, extra: null, position: 1 };

  it("needs every score, and keeps only flags whose scene is found exactly once", () => {
    const reply = JSON.stringify({
      scores: scores(4),
      notes,
      flags: [
        {
          dimension: "theme",
          start: "Pierrot explained to Harlequin that he felt sad",
          end: "agreed that it was sad.",
          problem: "Says the feeling out loud.",
          direction: "Show it through what they do with the leaks.",
        },
        {
          dimension: "subplot",
          start: "Not in the chapter at all",
          end: "the show began",
          problem: "p",
          direction: "d",
        },
        {
          dimension: "nonsense",
          start: "The rain kept on all morning",
          end: "three places.",
          problem: "p",
          direction: "d",
        },
      ],
    });
    const parsed = parseFanficEditorReply(reply, chapter);
    expect(parsed.scores.theme).toBe(4);
    expect(parsed.flags).toHaveLength(1);
    expect(parsed.flags[0]).toMatchObject({ dimension: "theme" });
    expect(parsed.dropped).toBe(2);
    expect(() => parseFanficEditorReply(JSON.stringify({ scores: { escalation: 5 } }), chapter)).toThrow(
      /no 0-10 score for subplot/,
    );
  });

  it("locates a scene from its first words to its last", () => {
    const span = locateFanficScene(chapterTwo, {
      startQuote: "Pierrot explained to Harlequin",
      endQuote: "agreed that it was sad.",
    });
    expect(chapterTwo.slice(span!.start, span!.end)).toBe(
      "Pierrot explained to Harlequin that he felt sad and that sadness is when you feel bad. Harlequin nodded and agreed that it was sad.",
    );
    expect(
      locateFanficScene(chapterTwo, {
        startQuote: "agreed that it was sad.",
        endQuote: "Pierrot explained to Harlequin",
      }),
    ).toBeNull();
  });
});

describe("runFanficEditorPass", () => {
  it("scores each chapter once, saves reports as they arrive, and skips chapters already current", async () => {
    const { storage, chat } = storageWith([chapterOne, chapterTwo]);
    const { llm, requests } = scriptedLlm(() => JSON.stringify({ scores: scores(6), notes, flags: [] }));
    const progress: number[] = [];

    const store = await runFanficEditorPass(
      { storage, llm },
      { chatId: "chat-1" },
      { onProgress: (p) => progress.push(p.done) },
    );

    expect(store.reports.map((report) => report.chapter)).toEqual([1, 2]);
    expect(store.reports[1]!.textKey).toBe(fanficChapterTextKey(chapterTwo));
    expect(requests[1]!.messages[1]!.content).toContain("The end of chapter 1");
    expect(progress).toEqual([0, 1, 2]);
    expect(readFanficEditorStore(chat.metadata).reports).toHaveLength(2);

    await runFanficEditorPass({ storage, llm }, { chatId: "chat-1" });
    expect(requests).toHaveLength(2);
  });

  it("scores extra chapters in reading order by their label, and keeps side stories out of other chapters", async () => {
    const side = "Pierrot dreamed of the sea that night, a side story.";
    const { storage } = storageWith([chapterOne, chapterTwo, sideStory(side)]);
    const { llm, requests } = scriptedLlm(() => JSON.stringify({ scores: scores(6), notes, flags: [] }));

    const store = await runFanficEditorPass({ storage, llm }, { chatId: "chat-1" });

    expect(store.reports.map((report) => report.messageId).sort()).toEqual(["m1", "m2", "x1"]);
    expect(requests[1]!.messages[0]!.content).toContain("reading chapter 1.5 of a requested fanfic");
    expect(requests[1]!.messages[1]!.content).toContain("The end of chapter 1:");
    expect(requests[1]!.messages[1]!.content).toContain(`## Chapter 1.5\n\n${side}`);
    expect(requests[2]!.messages[1]!.content).toContain("The end of chapter 1:");
    expect(requests[2]!.messages[1]!.content).not.toContain(side);
  });
});

describe("rewriteFanficFlaggedScenes", () => {
  const report: FanficEditorReport = {
    chapter: 2,
    messageId: "m2",
    textKey: fanficChapterTextKey(chapterTwo),
    scores: scores(4),
    notes,
    flags: [
      {
        dimension: "theme",
        startQuote: "Pierrot explained to Harlequin",
        endQuote: "agreed that it was sad.",
        problem: "Says the feeling out loud.",
        direction: "Show it.",
      },
      {
        dimension: "escalation",
        startQuote: "Then the show began on time.",
        endQuote: "Then the show began on time.",
        problem: "Nothing rises.",
        direction: "Make the show start late.",
      },
    ],
    dropped: 0,
  };

  it("rewrites only the flagged scenes and saves one new version", async () => {
    const { storage, messages } = storageWith([chapterOne, chapterTwo]);
    const { llm, requests } = scriptedLlm((llmRequest) =>
      llmRequest.messages[1]!.content.includes("## The passage to rewrite\nThen the show began on time.")
        ? "The show started an hour late, and nobody asked why."
        : "```\nPierrot wrung out the same rag for the third time. Harlequin watched him do it and didn't laugh.\n```",
    );

    const result = await rewriteFanficFlaggedScenes({ storage, llm }, { chatId: "chat-1", report });

    expect(result).toMatchObject({ rewritten: 2, skipped: 0 });
    expect(requests).toHaveLength(2);
    expect(messages[1]!.swipes).toHaveLength(2);
    expect(messages[1]!.content).toBe(
      "The rain kept on all morning and the tent leaked in three places. Pierrot wrung out the same rag for the third time. Harlequin watched him do it and didn't laugh. The show started an hour late, and nobody asked why.",
    );
    expect(result.textKey).toBe(fanficChapterTextKey(messages[1]!.content));
  });

  it("saves the rewritten scenes as a version written by the chapter's models and then the rewriting model", async () => {
    const { storage, messages } = storageWith([chapterOne, chapterTwo]);
    const writer = { connectionId: "conn-w", name: "Writer", model: "big-model" };
    Object.assign(messages[1]!, {
      activeSwipeIndex: 0,
      extra: { fanficVersion: { models: [writer], origin: { kind: "chapter", notes: "" }, unfinished: null } },
    });
    const { llm } = scriptedLlm(() => "Pierrot wrung out the same rag again.");

    await rewriteFanficFlaggedScenes({ storage, llm }, { chatId: "chat-1", report });

    expect(storage.addChatMessageSwipe.mock.calls[0]?.[3]).toEqual({
      activate: true,
      extra: {
        fanficVersion: {
          models: [writer, { connectionId: "conn-1", name: "Editor", model: "edit-model" }],
          origin: {
            kind: "revise",
            notes:
              "Shows its theme: Says the feeling out loud. Show it.\nStakes build: Nothing rises. Make the show start late.",
            baseVersion: 0,
          },
          unfinished: null,
        },
      },
    });
  });

  it("names an extra chapter by its label when rewriting its scenes", async () => {
    const { storage, messages } = storageWith([chapterOne, sideStory(chapterTwo)]);
    const { llm, requests } = scriptedLlm(() => "Pierrot wrung out the same rag again.");

    await rewriteFanficFlaggedScenes({ storage, llm }, { chatId: "chat-1", report: { ...report, messageId: "x1" } });

    expect(requests[0]!.messages[0]!.content).toContain("You revise one passage of chapter 1.5 of");
    expect(messages[1]!.swipes).toHaveLength(2);
  });

  it("refuses when the chapter changed since its report", async () => {
    const { storage } = storageWith([chapterOne, `${chapterTwo} An extra line.`]);
    const { llm } = scriptedLlm(() => "x");
    await expect(rewriteFanficFlaggedScenes({ storage, llm }, { chatId: "chat-1", report })).rejects.toThrow(
      /changed since then/,
    );
  });
});

describe("loadFanficChapterForEdit", () => {
  it("loads an extra chapter with its own write instruction", async () => {
    const { storage } = storageWith([chapterOne, sideStory(chapterTwo)]);
    const target = await loadFanficChapterForEdit(storage, {
      chatId: "chat-1",
      messageId: "x1",
      textKey: fanficChapterTextKey(chapterTwo),
    });
    expect(target.chapter.label).toBe("1.5");
    expect(target.chapterGuide).toContain("Write chapter 1.5 now");
    expect(target.chapterGuide).toContain("It picks up from the end of chapter 1.");
  });

  it("gives an extra that follows a side story the ledger state after its main chapter", async () => {
    const later = { ...sideStory("Pierrot slept in the props wagon."), id: "x2" };
    const { storage, chat } = storageWith([chapterOne, sideStory(chapterTwo), later]);
    chat.metadata = {
      ...(chat.metadata as Record<string, unknown>),
      fanficLedger: {
        version: 1,
        entries: [
          {
            chapter: 1,
            messageId: "m1",
            textKey: fanficChapterTextKey(chapterOne),
            summary: "Dinner for two.",
            timeline: "Day 1",
            knowledge: [],
            conditions: [],
            relationships: [],
            openThreads: [],
          },
        ],
      },
    };

    const target = await loadFanficChapterForEdit(storage, {
      chatId: "chat-1",
      messageId: "x2",
      textKey: fanficChapterTextKey(later.content),
    });

    expect(target.chapter.label).toBe("1.6");
    expect(target.ledgerState).toBe("When:\nDay 1");
  });
});

describe("passage rewrite prompt", () => {
  it("sends the text on both sides and asks for only the passage", () => {
    const [system, user] = buildFanficPassageRewriteMessages({
      state: createFanficState(request),
      chapterLabel: "2",
      ledgerState: "When:\nDay 2",
      before: "Before text.",
      passage: "The passage.",
      after: "After text.",
      instruction: "Make it tense.",
    });
    expect(system!.content).toContain("join the text before and after it");
    expect(system!.content).toContain("## Where things stand going into chapter 2");
    expect(user!.content).toContain("## The passage to rewrite\nThe passage.");
    expect(user!.content).toContain("## What to change\nMake it tense.");
    expect(cleanFanficPassageReply('"""\nNew text.\n"""')).toBe("New text.");
    expect(cleanFanficPassageReply("## Rewritten passage\nNew text.")).toBe("New text.");
  });
});

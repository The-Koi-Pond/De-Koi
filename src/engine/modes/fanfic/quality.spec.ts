import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficContinuityIssue, FanficQualityCriterionId } from "../../contracts/types/fanfic";
import { FANFIC_CONTINUITY_CATEGORIES } from "../../contracts/types/fanfic";
import {
  averageFanficRubrics,
  buildFanficContinuityMessages,
  buildFanficRubricMessages,
  deleteFanficQualityRun,
  FANFIC_CONTINUITY_SWEEPS,
  FANFIC_QUALITY_CRITERIA,
  FANFIC_QUALITY_MAX_RUNS,
  FanficQualityParseError,
  fanficTextKey,
  groundFanficContinuityIssues,
  parseFanficContinuityReply,
  parseFanficContinuityVerdicts,
  parseFanficRubricReply,
  readFanficQualityStore,
  runFanficQualityCheck,
  scoreFanficMechanics,
  summarizeFanficRubric,
} from "./quality";
import { createFanficState, defaultFanficRequest } from "./request";

const request = {
  ...defaultFanficRequest(),
  fandom: "The Freak Circus",
  characters: ["Pierrot", "Harlequin"],
  prompt: "Pierrot learns to share.",
  chapterCount: 1,
};

const chapterOne =
  "Pierrot set the red ball on the windowsill and left it there. His left hand was bandaged from the knife the night before. Harlequin watched from the doorway, saying nothing at all.";
const chapterTwo =
  "By morning Pierrot was juggling with both hands, neither of them hurt. He tossed the blue ball to Harlequin, who caught it without looking.";

function scoresBlock(overrides: Partial<Record<FanficQualityCriterionId, number>> = {}): string {
  return FANFIC_QUALITY_CRITERIA.map((criterion) => `${criterion.name}: ${overrides[criterion.id] ?? 10}`).join("\n");
}

const rubricReply = `## Analysis\nCompetent but safe. The stakes never build.\n\n## Scores\n${scoresBlock({ compelling_plot: 14, purple_prose: 4 })}`;

const injuryIssue = {
  category: "detail",
  subtype: "injury vanishes",
  earlierChapter: 1,
  earlierQuote: "His left hand was bandaged from the knife the night before",
  laterChapter: 2,
  laterQuote: "juggling with both hands, neither of them hurt",
  explanation: "The hand heals overnight.",
};

function storageWith(chapters: string[], metadata: Record<string, unknown> = {}) {
  const records: Record<string, Record<string, unknown>> = {
    "chat-1": {
      id: "chat-1",
      mode: "fanfic",
      connectionId: "conn-1",
      characterIds: [],
      metadata: { fanfic: { ...createFanficState(request), outlineApproved: true }, ...metadata },
    },
  };
  const connections: Record<string, Record<string, unknown>> = {
    "conn-1": { id: "conn-1", name: "Claude", model: "claude-opus-5-5" },
    "conn-2": { id: "conn-2", name: "Judge", model: "judge-model" },
  };
  const storage = {
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats") return (records[id] ?? null) as T | null;
      if (entity === "connections") return (connections[id] ?? null) as T | null;
      return null;
    },
    async listChatMessages<T = unknown>(): Promise<T[]> {
      return [
        { id: "u0", role: "user", content: "ignored" },
        ...chapters.map((content, index) => ({ id: `m${index + 1}`, role: "assistant", content })),
      ] as T[];
    },
    async patchChatMetadata<T = unknown>(chatId: string, patch: Record<string, unknown>): Promise<T> {
      records[chatId] = { ...records[chatId], metadata: { ...(records[chatId]?.metadata as object), ...patch } };
      return records[chatId] as T;
    },
  } as unknown as StorageGateway;
  return { storage, records };
}

/** Answers each judge prompt by its opening line, so parallel calls can't be mixed up. */
function judgeLlm(replies: { rubric: string[]; continuity: string[]; verify: string[] }) {
  const requests: LlmRequest[] = [];
  const llm: LlmGateway & { requests: LlmRequest[] } = {
    requests,
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      const system = llmRequest.messages[0]?.content ?? "";
      if (system.startsWith("You are a continuity editor")) return replies.continuity.shift() ?? "";
      if (system.startsWith("You double-check")) return replies.verify.shift() ?? "";
      return replies.rubric.shift() ?? "";
    }),
    async *stream() {
      yield { type: "token", text: "" };
    },
    listModels: vi.fn(async () => []),
  };
  return llm;
}

describe("parseFanficRubricReply", () => {
  it("reads every criterion and the analysis, tolerating bold names and bracketed scores", () => {
    const raw = `<thinking>hm</thinking>## Analysis\nSolid.\n\n## Scores\n${scoresBlock()
      .replace("Coherent: 10", "**Coherent**: [17]")
      .replace("Pacing: 10", "- Pacing: 12")}`;
    const result = parseFanficRubricReply(raw);
    expect(result.criteria.coherent).toBe(17);
    expect(result.criteria.pacing).toBe(12);
    expect(result.analysis).toBe("Solid.");
  });

  it("refuses a reply with a criterion missing or out of range", () => {
    expect(() => parseFanficRubricReply(`## Scores\n${scoresBlock().replace(/^Pacing: 10\n/m, "")}`)).toThrow(
      FanficQualityParseError,
    );
    expect(() => parseFanficRubricReply(`## Scores\n${scoresBlock().replace("Pacing: 10", "Pacing: 25")}`)).toThrow(
      FanficQualityParseError,
    );
  });
});

describe("summarizeFanficRubric", () => {
  it("inverts faults and reports 0-10 groups", () => {
    const criteria = Object.fromEntries(
      FANFIC_QUALITY_CRITERIA.map((criterion) => [criterion.id, criterion.negative ? 0 : 20]),
    ) as Record<FanficQualityCriterionId, number>;
    expect(summarizeFanficRubric(criteria)).toEqual({
      groups: { creativity: 10, coherence: 10, character: 10, prose: 10 },
      overall: 10,
    });
    const worst = Object.fromEntries(
      FANFIC_QUALITY_CRITERIA.map((criterion) => [criterion.id, criterion.negative ? 20 : 0]),
    ) as Record<FanficQualityCriterionId, number>;
    expect(summarizeFanficRubric(worst).overall).toBe(0);
  });
});

describe("continuity grounding", () => {
  const chapters = [chapterOne, chapterTwo];

  it("keeps issues whose quotes are in the fic, despite curly quotes and line breaks", () => {
    const issue: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      earlierQuote: "His left hand was\nbandaged from the knife",
    };
    const { grounded, dropped } = groundFanficContinuityIssues([issue], chapters);
    expect(dropped).toBe(0);
    expect(grounded[0]).toMatchObject({ earlierChapter: 1, laterChapter: 2 });
  });

  it("fixes a misnumbered chapter, reorders swapped passages, and drops paraphrased quotes", () => {
    const swapped: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      earlierChapter: 2,
      earlierQuote: injuryIssue.laterQuote,
      laterChapter: 2,
      laterQuote: injuryIssue.earlierQuote,
    };
    const paraphrased: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      earlierQuote: "Pierrot hurt his hand badly",
    };
    const { grounded, dropped } = groundFanficContinuityIssues([swapped, paraphrased], chapters);
    expect(dropped).toBe(1);
    expect(grounded).toHaveLength(1);
    expect(grounded[0]).toMatchObject({
      earlierChapter: 1,
      earlierQuote: injuryIssue.earlierQuote,
      laterChapter: 2,
      laterQuote: injuryIssue.laterQuote,
    });
  });

  it("merges one contradiction quoted two ways, but keeps different ones between the same chapters", () => {
    const shorterSpan: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      subtype: "hand heals overnight",
      earlierQuote: "Pierrot set the red ball on the windowsill and left it there. His left hand was bandaged",
    };
    const differentPair: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      subtype: "ball color",
      earlierQuote: "set the red ball on the windowsill",
      laterQuote: "tossed the blue ball to Harlequin",
    };
    const { grounded } = groundFanficContinuityIssues(
      [injuryIssue as FanficContinuityIssue, shorterSpan, differentPair],
      chapters,
    );
    expect(grounded.map((issue) => issue.subtype)).toEqual(["injury vanishes", "ball color"]);
  });

  it("parses the editor's issues and the checker's verdicts", () => {
    const issues = parseFanficContinuityReply(
      "```json\n" +
        JSON.stringify({ issues: [{ ...injuryIssue, category: "made-up", laterQuote: '“"I only have two."”' }] }) +
        "\n```",
    );
    expect(issues[0]).toMatchObject({ category: "detail", earlierChapter: 1, laterQuote: "I only have two." });
    expect(() => parseFanficContinuityReply("no issues found")).toThrow(FanficQualityParseError);
    const verdicts = parseFanficContinuityVerdicts(
      JSON.stringify({
        verdicts: [
          { note: 1, contradiction: true },
          { note: 2, contradiction: false },
          { note: 9, contradiction: true },
        ],
      }),
      2,
    );
    expect([...verdicts]).toEqual([1]);
  });
});

describe("scoreFanficMechanics", () => {
  it("normalizes detector hits per 1,000 words", () => {
    const tells = "He did not move. She did not speak. In that moment, something shifted between them. ".repeat(10);
    const mechanics = scoreFanficMechanics([tells, chapterTwo], ["pierrot", "harlequin"]);
    expect(mechanics.words).toBeGreaterThan(150);
    expect(mechanics.aiTellHits).toBeGreaterThan(10);
    expect(mechanics.aiTellsPer1k).toBeCloseTo((mechanics.aiTellHits / mechanics.words) * 1000, 1);
    expect(mechanics.topTells[0].count).toBeGreaterThanOrEqual(mechanics.topTells.at(-1)!.count);
  });
});

describe("judge prompts", () => {
  it("score against what was written, not the one-shot plan, and use markdown headings only", () => {
    const rubric = buildFanficRubricMessages({ request, chapters: [chapterOne, chapterTwo] });
    const continuity = buildFanficContinuityMessages({ request, chapters: [chapterOne, chapterTwo] });
    for (const messages of [rubric, continuity]) {
      const text = messages.map((message) => message.content).join("\n");
      expect(text).toContain("Length: 2 chapters");
      expect(text).toContain("### Chapter 2");
      expect(text).not.toMatch(/<\/?[a-z_]+>/i);
    }
  });

  it("splits the continuity sweep so every category is covered exactly once", () => {
    const covered = FANFIC_CONTINUITY_SWEEPS.flat();
    expect([...covered].sort()).toEqual([...FANFIC_CONTINUITY_CATEGORIES].sort());
    const [system] = buildFanficContinuityMessages({
      request,
      chapters: [chapterOne],
      categories: FANFIC_CONTINUITY_SWEEPS[0],
    });
    expect(system.content).toContain("another pass covers the rest");
    expect(system.content).toContain("category is one of: timeline, character.");
    expect(system.content).not.toContain("- detail (");
  });
});

describe("averageFanficRubrics", () => {
  it("averages each criterion and reports how far the reads disagreed", () => {
    const high = parseFanficRubricReply(`## Scores\n${scoresBlock({ coherent: 16 })}`);
    const low = parseFanficRubricReply(`## Analysis\nHarsh.\n## Scores\n${scoresBlock({ coherent: 4 })}`);
    const averaged = averageFanficRubrics([high, low]);
    expect(averaged.criteria.coherent).toBe(10);
    expect(averaged.passes).toBe(2);
    expect(averaged.analysis).toBe("Harsh.");
    expect(averaged.spread).toBeCloseTo(
      summarizeFanficRubric(high.criteria).overall - summarizeFanficRubric(low.criteria).overall,
      1,
    );
  });
});

describe("runFanficQualityCheck", () => {
  it("scores the active chapters, keeps only confirmed contradictions, and saves the run", async () => {
    const { storage, records } = storageWith([chapterOne, chapterTwo]);
    const other = {
      ...injuryIssue,
      earlierQuote: "set the red ball on the windowsill",
      laterQuote: "tossed the blue ball to Harlequin",
      explanation: "Ball color.",
    };
    const llm = judgeLlm({
      rubric: [rubricReply, rubricReply.replace("Compelling Plot: 14", "Compelling Plot: 12")],
      continuity: [
        JSON.stringify({ issues: [injuryIssue, { ...injuryIssue, earlierQuote: "never said this" }] }),
        // The second sweep reports the injury again, swapped: one issue, not two.
        JSON.stringify({
          issues: [
            other,
            { ...injuryIssue, earlierQuote: injuryIssue.laterQuote, laterQuote: injuryIssue.earlierQuote },
          ],
        }),
      ],
      verify: [
        JSON.stringify({
          verdicts: [
            { note: 1, contradiction: true },
            { note: 2, contradiction: false },
          ],
        }),
      ],
    });
    const phases: string[] = [];
    const run = await runFanficQualityCheck(
      { storage, llm },
      { chatId: "chat-1", label: " baseline " },
      { onPhase: (phase) => phases.push(phase), now: () => new Date("2026-10-17T12:00:00Z") },
    );

    expect(phases).toEqual(["counting", "judging", "verifying_continuity"]);
    expect(run).toMatchObject({
      label: "baseline",
      createdAt: "2026-10-17T12:00:00.000Z",
      chapterCount: 2,
      judge: { connectionId: "conn-1", model: "claude-opus-5-5" },
      continuity: { candidates: 4, ungrounded: 1, rejected: 1 },
    });
    expect(run.continuity.issues.map((issue) => issue.subtype)).toEqual(["injury vanishes"]);
    expect(run.rubric).toMatchObject({ passes: 2 });
    expect(run.rubric.criteria.compelling_plot).toBe(13);
    expect(run.rubric.spread).toBeGreaterThan(0);
    expect(run.textKey).toBe(fanficTextKey([chapterOne, chapterTwo]));
    expect(llm.requests).toHaveLength(5);
    expect(llm.requests.every((entry) => entry.parameters?.temperature === 0)).toBe(true);
    expect(readFanficQualityStore(records["chat-1"].metadata).runs.map((saved) => saved.id)).toEqual([run.id]);
    // The fic's own state is untouched.
    expect((records["chat-1"].metadata as { fanfic: unknown }).fanfic).toBeTruthy();
  });

  it("retries a malformed judge reply once, skips verification with nothing to verify, and caps the history", async () => {
    const old = Array.from({ length: FANFIC_QUALITY_MAX_RUNS }, (_, index) => ({
      id: `old-${index}`,
      mechanics: {},
      rubric: {},
      continuity: {},
    }));
    const { storage, records } = storageWith([chapterOne], { fanficQuality: { runs: old } });
    const llm = judgeLlm({
      rubric: ["I liked it!", rubricReply, rubricReply],
      continuity: ['{"issues": []}', '{"issues": []}'],
      verify: [],
    });
    const run = await runFanficQualityCheck({ storage, llm }, { chatId: "chat-1", connectionId: "conn-2" });
    expect(run.judge.model).toBe("judge-model");
    expect(llm.requests).toHaveLength(5);
    const runs = readFanficQualityStore(records["chat-1"].metadata).runs;
    expect(runs).toHaveLength(FANFIC_QUALITY_MAX_RUNS);
    expect(runs[0].id).toBe("old-1");
    expect(runs.at(-1)!.id).toBe(run.id);

    await deleteFanficQualityRun(storage, "chat-1", run.id);
    expect(readFanficQualityStore(records["chat-1"].metadata).runs.map((saved) => saved.id)).not.toContain(run.id);
  });

  it("stops at once on abort even when the gateway can't cancel, and saves nothing", async () => {
    const { storage, records } = storageWith([chapterOne]);
    const llm = judgeLlm({ rubric: [], continuity: [], verify: [] });
    llm.complete = vi.fn(() => new Promise<string>(() => {}));
    const controller = new AbortController();
    const running = runFanficQualityCheck({ storage, llm }, { chatId: "chat-1" }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(readFanficQualityStore(records["chat-1"].metadata).runs).toEqual([]);
  });

  it("refuses a random connection or a fic with no chapters", async () => {
    const empty = storageWith([]);
    const llm = judgeLlm({ rubric: [], continuity: [], verify: [] });
    await expect(runFanficQualityCheck({ storage: empty.storage, llm }, { chatId: "chat-1" })).rejects.toThrow(
      "Write a chapter",
    );
    await expect(
      runFanficQualityCheck(
        { storage: storageWith([chapterOne]).storage, llm },
        { chatId: "chat-1", connectionId: "random" },
      ),
    ).rejects.toThrow("Pick a connection");
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

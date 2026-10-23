import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import type { StorageEntity, StorageGateway } from "../../capabilities/storage";
import type { FanficContinuityIssue, FanficQualityCriterionId, FanficQualityRun } from "../../contracts/types/fanfic";
import { FANFIC_CONTINUITY_CATEGORIES } from "../../contracts/types/fanfic";
import {
  fanficTextHolds,
  averageFanficRubrics,
  buildFanficContinuityMessages,
  buildFanficRubricMessages,
  confirmedFanficContinuityIssues,
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
  chooseFanficJudge,
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

function storageWith(chapters: string[], metadata: Record<string, unknown> = {}, modelRouting?: unknown) {
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
      if (entity === "app-settings" && id === "model-routing" && modelRouting !== undefined) {
        return { id, value: modelRouting } as T;
      }
      return null;
    },
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      return (entity === "connections" ? Object.values(connections) : []) as T[];
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
    // Compare-and-set on metadata keys, like the runtime's chat_matches_expected_values.
    async updateChatIfUnchanged<T = unknown>(
      chatId: string,
      expected: { metadata: Record<string, unknown> },
      patch: { metadata: Record<string, unknown> },
    ): Promise<{ updated: boolean; chat: T }> {
      beforeWrite?.();
      const current = records[chatId].metadata as Record<string, unknown>;
      const same = Object.entries(expected.metadata).every(
        ([key, value]) => JSON.stringify(current[key] ?? null) === JSON.stringify(value),
      );
      if (same) records[chatId] = { ...records[chatId], metadata: { ...current, ...patch.metadata } };
      return { updated: same, chat: records[chatId] as T };
    },
  } as unknown as StorageGateway;
  let beforeWrite: (() => void) | undefined;
  return {
    storage,
    records,
    /** Runs once before the next compare-and-set, to simulate another tab writing in between. */
    interfere(write: () => void) {
      beforeWrite = () => {
        beforeWrite = undefined;
        write();
      };
    },
  };
}

function savedRun(id: string, overrides: Partial<FanficQualityRun> = {}): FanficQualityRun {
  return {
    id,
    createdAt: "2026-10-17T00:00:00.000Z",
    label: "",
    judgeVersion: 1,
    judge: { connectionId: "conn-1", connectionName: "Claude", model: "claude-opus-5-5" },
    chapterCount: 1,
    textKey: "1-x",
    mechanics: scoreFanficMechanics([chapterOne], []),
    rubric: {
      criteria: Object.fromEntries(FANFIC_QUALITY_CRITERIA.map((criterion) => [criterion.id, 10])) as Record<
        FanficQualityCriterionId,
        number
      >,
      groups: { creativity: 5, coherence: 5, character: 5, prose: 5 },
      overall: 5,
      analysis: "",
      passes: 2,
      spread: 0,
    },
    continuity: { issues: [], candidates: 0, ungrounded: 0, rejected: 0, merged: 0, per10k: 0 },
    ...overrides,
  };
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

  it("drops an exact repeat, but keeps slips that share only one passage", () => {
    const sameBothSides: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      subtype: "hand heals overnight",
      earlierQuote: "His left hand was bandaged from the knife",
      laterQuote: "neither of them hurt",
    };
    // Same earlier passage, different later evidence: a separate contradiction that must survive.
    const sharedEarlierOnly: FanficContinuityIssue = {
      ...(injuryIssue as FanficContinuityIssue),
      subtype: "knife hand catches",
      laterQuote: "who caught it without looking",
    };
    const { grounded } = groundFanficContinuityIssues(
      [injuryIssue as FanficContinuityIssue, sameBothSides, sharedEarlierOnly],
      chapters,
    );
    expect(grounded.map((issue) => issue.subtype)).toEqual(["injury vanishes", "knife hand catches"]);
    // The same two passages read as a different kind of contradiction is a separate note.
    const otherKind: FanficContinuityIssue = { ...(injuryIssue as FanficContinuityIssue), category: "timeline" };
    expect(
      groundFanficContinuityIssues([injuryIssue as FanficContinuityIssue, otherKind], chapters).grounded,
    ).toHaveLength(2);
  });

  it("parses the editor's issues and refuses broken entries so the reply is retried", () => {
    const issues = parseFanficContinuityReply(
      "```json\n" +
        JSON.stringify({ issues: [{ ...injuryIssue, category: "made-up", laterQuote: '“"I only have two."”' }] }) +
        "\n```",
    );
    expect(issues[0]).toMatchObject({ category: "detail", earlierChapter: 1, laterQuote: "I only have two." });
    expect(parseFanficContinuityReply('{"issues": []}')).toEqual([]);
    for (const broken of [
      "no issues found",
      '{"issues": [{}]}',
      '{"issues": ["a slip"]}',
      JSON.stringify({ issues: [{ ...injuryIssue, laterQuote: "" }] }),
      JSON.stringify({ issues: [{ ...injuryIssue, explanation: " " }] }),
    ]) {
      expect(() => parseFanficContinuityReply(broken), broken).toThrow(FanficQualityParseError);
    }
  });

  it("needs a verdict on every note, and folds a confirmed repeat into the note it repeats", () => {
    const verdicts = parseFanficContinuityVerdicts(
      JSON.stringify({
        verdicts: [
          { note: 1, reason: "r", contradiction: true, sameAs: null },
          { note: 2, reason: "r", contradiction: false, sameAs: null },
          { note: 3, reason: "r", contradiction: true, sameAs: 1 },
        ],
      }),
      3,
    );
    expect([...verdicts.confirmed]).toEqual([1, 3]);
    expect(verdicts.sameAs.get(3)).toBe(1);
    const notes = ["a", "b", "c"].map((subtype) => ({ ...(injuryIssue as FanficContinuityIssue), subtype }));
    expect(confirmedFanficContinuityIssues(notes, verdicts)).toMatchObject({
      confirmed: [{ subtype: "a" }],
      merged: 1,
    });
    // A repeat of a rejected note stands on its own.
    const repeatOfRejected = parseFanficContinuityVerdicts(
      JSON.stringify({
        verdicts: [
          { note: 1, contradiction: false },
          { note: 2, contradiction: true, sameAs: 1 },
        ],
      }),
      2,
    );
    expect(confirmedFanficContinuityIssues(notes.slice(0, 2), repeatOfRejected).confirmed).toHaveLength(1);

    for (const partial of [
      { verdicts: [{ note: 1, contradiction: true }] },
      {
        verdicts: [
          { note: 1, contradiction: true },
          { note: 1, contradiction: false },
        ],
      },
      {
        verdicts: [
          { note: 1, contradiction: true },
          { note: 9, contradiction: true },
        ],
      },
      {
        verdicts: [
          { note: 1, contradiction: "yes" },
          { note: 2, contradiction: true },
        ],
      },
    ]) {
      expect(() => parseFanficContinuityVerdicts(JSON.stringify(partial), 2), JSON.stringify(partial)).toThrow(
        FanficQualityParseError,
      );
    }
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
      // Every candidate is accounted for: 1 confirmed + 1 ungrounded + 1 rejected + 1 repeat.
      continuity: { candidates: 4, ungrounded: 1, rejected: 1, merged: 1 },
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
    const old = Array.from({ length: FANFIC_QUALITY_MAX_RUNS }, (_, index) => savedRun(`old-${index}`));
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

  it("judges with the fanfic judge route when no judge is picked, and with the pick when one is", async () => {
    const routes = { version: 1, routes: { judge: "conn-2" } };
    const replies = () => ({
      rubric: [rubricReply, rubricReply, rubricReply],
      continuity: ['{"issues": []}', '{"issues": []}'],
      verify: [],
    });
    const routed = judgeLlm(replies());
    const routedRun = await runFanficQualityCheck(
      { storage: storageWith([chapterOne], {}, routes).storage, llm: routed },
      { chatId: "chat-1" },
    );
    expect(routedRun.judge).toMatchObject({ connectionId: "conn-2", model: "judge-model" });
    expect(routed.requests.every((entry) => entry.connectionId === "conn-2")).toBe(true);

    const picked = judgeLlm(replies());
    const pickedRun = await runFanficQualityCheck(
      { storage: storageWith([chapterOne], {}, routes).storage, llm: picked },
      { chatId: "chat-1", connectionId: "conn-1" },
    );
    expect(pickedRun.judge.connectionId).toBe("conn-1");
  });

  it("refuses to judge when the fanfic judge route is broken and no judge is picked", async () => {
    const llm = judgeLlm({ rubric: [], continuity: [], verify: [] });
    await expect(
      runFanficQualityCheck(
        { storage: storageWith([chapterOne], {}, { version: 1, routes: { judge: "gone" } }).storage, llm },
        { chatId: "chat-1" },
      ),
    ).rejects.toThrow("The Fanfic judge helper is set to a connection that no longer exists.");
    expect(llm.requests).toHaveLength(0);
  });

  it("refuses a hand-picked remote judge when the judge must stay on this device", async () => {
    const llm = judgeLlm({ rubric: [], continuity: [], verify: [] });
    await expect(
      runFanficQualityCheck(
        { storage: storageWith([chapterOne], {}, { version: 1, routes: {}, localOnly: ["judge"] }).storage, llm },
        { chatId: "chat-1", connectionId: "conn-1" },
      ),
    ).rejects.toMatchObject({ name: "ModelRouteError", problem: "not_local" });
    expect(llm.requests).toHaveLength(0);
  });

  it("keeps a run another tab saved while this one was saving", async () => {
    const harness = storageWith([chapterOne], { fanficQuality: { runs: [savedRun("first")] } });
    harness.interfere(() => {
      const metadata = harness.records["chat-1"].metadata as Record<string, unknown>;
      harness.records["chat-1"].metadata = {
        ...metadata,
        fanficQuality: { runs: [savedRun("first"), savedRun("other-tab")] },
      };
    });
    const llm = judgeLlm({
      rubric: [rubricReply, rubricReply],
      continuity: ['{"issues": []}', '{"issues": []}'],
      verify: [],
    });
    const run = await runFanficQualityCheck({ storage: harness.storage, llm }, { chatId: "chat-1" });
    expect(readFanficQualityStore(harness.records["chat-1"].metadata).runs.map((saved) => saved.id)).toEqual([
      "first",
      "other-tab",
      run.id,
    ]);
  });

  it("skips stored runs missing fields the panel reads", () => {
    const broken = { ...savedRun("broken"), judge: { connectionId: "conn-1" } };
    const noGroups = { ...savedRun("no-groups"), rubric: { ...savedRun("x").rubric, groups: {} } };
    const nullTell = { ...savedRun("null-tell"), mechanics: { ...savedRun("x").mechanics, topTells: [null] } };
    const kindless = {
      ...savedRun("kindless"),
      mechanics: { ...savedRun("x").mechanics, repeats: [{ term: "Bells", count: 48 }] },
    };
    const metadata = {
      fanficQuality: { runs: [savedRun("good"), broken, noGroups, nullTell, kindless, { id: "bare" }] },
    };
    expect(readFanficQualityStore(metadata).runs.map((saved) => saved.id)).toEqual(["good"]);
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

describe("fanficTextHolds", () => {
  it("finds quotes as whole words, through punctuation and curly quotes", () => {
    expect(fanficTextHolds("“Don’t,” he said. He left the room.", "don't he said")).toBe(true);
    expect(fanficTextHolds("Bathe left the room.", "he left the room")).toBe(false);
    expect(fanficTextHolds("A caféhe left the room.", "he left the room")).toBe(false);
    expect(fanficTextHolds("He left the rooms.", "he left the room")).toBe(false);
    expect(fanficTextHolds("anything", "")).toBe(false);
  });
});

describe("chooseFanficJudge", () => {
  const connections = [
    { id: "conn-1", name: "Claude", model: "claude-opus-5-5" },
    { id: "conn-2", name: "Judge", model: "judge-model" },
    { id: "conn-3", name: "Blank", model: "" },
  ];
  const judgeIds = connections.map((connection) => connection.id);
  const routing = (routes: Record<string, string>) => ({ version: 1 as const, routes });

  it("keeps the fic's last judge so scores stay comparable", () => {
    expect(
      chooseFanficJudge({
        lastJudgeId: "conn-1",
        ficConnectionId: "conn-1",
        judgeIds,
        routing: routing({ judge: "conn-2" }),
        connections,
      }),
    ).toEqual({ judgeId: "conn-1", routeProblem: null, rule: "lastJudge" });
  });

  it("starts a fic without runs on the judge route", () => {
    expect(
      chooseFanficJudge({
        lastJudgeId: null,
        ficConnectionId: "conn-1",
        judgeIds,
        routing: routing({ judge: "conn-2" }),
        connections,
      }),
    ).toEqual({ judgeId: "conn-2", routeProblem: null, rule: "route" });
  });

  it("falls back to the fic's connection, then the first connection, only when nothing is routed", () => {
    expect(
      chooseFanficJudge({ lastJudgeId: null, ficConnectionId: "conn-1", judgeIds, routing: routing({}), connections }),
    ).toEqual({
      judgeId: "conn-1",
      routeProblem: null,
      rule: "chat",
    });
    expect(
      chooseFanficJudge({ lastJudgeId: "deleted", ficConnectionId: null, judgeIds, routing: routing({}), connections }),
    ).toEqual({
      judgeId: "conn-1",
      routeProblem: null,
      rule: "first",
    });
  });

  it("does not keep a remote last judge when the judge must stay on this device", () => {
    const local = { id: "local", name: "Local", provider: "custom", model: "m", baseUrl: "http://localhost:1/v1" };
    expect(
      chooseFanficJudge({
        lastJudgeId: "conn-1",
        ficConnectionId: "conn-1",
        judgeIds: [...judgeIds, "local"],
        routing: { version: 1, routes: { judge: "local" }, localOnly: ["judge"] },
        connections: [...connections, local],
      }),
    ).toEqual({
      judgeId: null,
      routeProblem: expect.stringContaining(
        'The Fanfic judge helper must stay on your device, but "Claude" sends work off it.',
      ),
      rule: null,
    });
    expect(
      chooseFanficJudge({
        lastJudgeId: "local",
        ficConnectionId: "conn-1",
        judgeIds: [...judgeIds, "local"],
        routing: { version: 1, routes: { judge: "local" }, localOnly: ["judge"] },
        connections: [...connections, local],
      }),
    ).toEqual({ judgeId: "local", routeProblem: null, rule: "lastJudge" });
  });

  it("picks nothing and says why when the judge route is broken", () => {
    expect(
      chooseFanficJudge({
        lastJudgeId: null,
        ficConnectionId: "conn-1",
        judgeIds,
        routing: routing({ judge: "conn-3" }),
        connections,
      }),
    ).toEqual({
      judgeId: null,
      routeProblem:
        'The Fanfic judge helper is set to "Blank", which has no model picked. Pick another connection, or "Same as today", in Connections → Helper Models.',
      rule: null,
    });
  });
});

import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import {
  automaticCaptureMemoryFailure,
  buildMemoryCaptureReport,
  extractCanonicalMemoryConsequences,
  standaloneMemoryFailure,
  type CanonicalConsequenceExtractionRequest,
} from "./automatic-memory-capture";

function gateway(response: unknown, requests: LlmRequest[] = []): LlmGateway {
  return {
    async complete(request) {
      requests.push(request);
      return JSON.stringify(response);
    },
    async *stream() {
      yield { type: "done" as const };
    },
    async listModels() {
      return [];
    },
  };
}

function request(): CanonicalConsequenceExtractionRequest {
  return {
    version: 1,
    jobId: "job-1",
    chatId: "chat-1",
    mode: "conversation",
    scope: { kind: "character", id: "pierrot" },
    activeCharacterId: "pierrot",
    userLabel: "Celia",
    characterLabels: { pierrot: "Pierrot" },
    sourceMessages: [
      {
        id: "user-current",
        chatId: "chat-1",
        role: "user",
        content: "My cat's name is Miso.",
        characterId: null,
        createdAt: "2026-07-30T12:01:00.000Z",
        speakerLabel: "Celia",
      },
      {
        id: "assistant-current",
        chatId: "chat-1",
        role: "assistant",
        content: "I don't want to talk about it.",
        characterId: "pierrot",
        createdAt: "2026-07-30T12:02:00.000Z",
        speakerLabel: "Pierrot",
      },
    ],
    referenceMessages: [
      {
        id: "user-reference",
        chatId: "chat-1",
        role: "user",
        content: "I meant the circus accident.",
        characterId: null,
        createdAt: "2026-07-30T12:00:00.000Z",
        speakerLabel: "Celia",
      },
    ],
    eligibleMemories: [],
    connectionId: "connection-1",
  };
}

describe("automatic memory consequence extraction", () => {
  it("prompts with named source and reference rows and accepts a standalone memory", async () => {
    const requests: LlmRequest[] = [];
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway(
        {
          memories: [
            {
              kind: "fact",
              content: "Celia's cat is named Miso.",
              confidence: 0.95,
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-current"],
            },
          ],
        },
        requests,
      ),
      request: request(),
    });

    const prompt = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("user-current | user | Celia | My cat's name is Miso.");
    expect(prompt).toContain("user-reference | user | Celia | I meant the circus accident.");
    expect(prompt).toContain("Every memory must make sense as an isolated sentence.");
    expect(prompt).toContain("Do not use third-person personal pronouns");
    expect(prompt).toContain("must be supported by cited source rows from that named speaker");
    expect(prompt).toContain("Preserve explicit one, single, this, or that scope");
    expect(prompt).toContain("Preserve each proposition's positive or negative polarity");
    expect(prompt).toContain("Preserve conditions, tense, uncertainty, and modality");
    expect(prompt).toContain("which clause is conditional");
    expect(prompt).toContain("Preserve each direct subject's identity");
    expect(prompt).toContain("Bind first-person forms anywhere in a cited row");
    expect(prompt).toContain("Preserve unresolved second-person argument slots");
    expect(prompt).toContain("Preserve role prepositions around second-person slots");
    expect(prompt).toContain("Preserve reporting acts and their certainty");
    expect(prompt).toContain("only a bare name or antecedent identity");
    expect(prompt).toContain("A commitment requires direct first-person intent");
    expect(prompt).toContain("Each confidence must be a JSON number from 0 to 1");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.content).toBe("Celia's cat is named Miso.");
  });

  it("classifies the reported context-dependent wording", () => {
    expect(standaloneMemoryFailure("User's cat is named Miso.")).toBe("generic_speaker_label");
    expect(standaloneMemoryFailure("The assistant promised to return.")).toBe("generic_speaker_label");
    expect(standaloneMemoryFailure("He said he would return.")).toBe("unresolved_opening_reference");
    expect(standaloneMemoryFailure("Pierrot said he does not want to talk about it.")).toBe("dangling_topic_reference");
    expect(standaloneMemoryFailure("{{user}}'s cat is named Miso.")).toBeNull();
    expect(standaloneMemoryFailure("{{UserName}} prefers tea.")).toBeNull();
    expect(standaloneMemoryFailure("Pierrot told Celia that he would return.")).toBeNull();
    expect(automaticCaptureMemoryFailure("Pierrot told Celia that he would return.")).toBe(
      "third_person_personal_pronoun",
    );
    expect(standaloneMemoryFailure("Pierrot does not want to discuss the circus accident.")).toBeNull();
  });

  it("rejects a candidate that gives Agent Cobalt the wrong third-person pronoun", async () => {
    const extractionRequest = request();
    extractionRequest.scope = { kind: "character", id: "cobalt" };
    extractionRequest.activeCharacterId = "cobalt";
    extractionRequest.characterLabels = { cobalt: "Agent Cobalt" };
    extractionRequest.sourceMessages = [
      {
        id: "assistant-cobalt",
        chatId: "chat-1",
        role: "assistant",
        content: "I will wait at the east gate.",
        characterId: "cobalt",
        createdAt: "2026-07-30T12:02:00.000Z",
        speakerLabel: "Agent Cobalt",
      },
    ];

    const result = await extractCanonicalMemoryConsequences({
      llm: gateway({
        memories: [
          {
            kind: "promise",
            content: "Agent Cobalt said she will wait at the east gate.",
            confidence: 0.95,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-cobalt"],
          },
        ],
      }),
      request: extractionRequest,
    });

    expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
  });

  it("uses reference context only to resolve wording and persists both provenance ID sets", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway({
        memories: [
          {
            kind: "plot_state",
            content: "Pierrot does not want to discuss the circus accident.",
            confidence: 0.91,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-current"],
            referenceMessageIds: ["user-reference"],
          },
          {
            kind: "fact",
            content: "User's cat is named Miso.",
            confidence: 0.95,
            evidence: "direct_user_assertion",
            sourceMessageIds: ["user-current"],
          },
          {
            kind: "plot_state",
            content: "He said he would return.",
            confidence: 0.91,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-current"],
          },
          {
            kind: "plot_state",
            content: "Pierrot said he does not want to talk about it.",
            confidence: 0.91,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-current"],
            referenceMessageIds: ["user-reference"],
          },
        ],
      }),
      request: request(),
    });

    expect(result.skippedCount).toBe(3);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        content: "Pierrot does not want to discuss the circus accident.",
        provenance: expect.objectContaining({
          messageIds: ["assistant-current", "user-reference"],
        }),
        payload: expect.objectContaining({
          sourceMessageIds: ["assistant-current"],
          referenceMessageIds: ["user-reference"],
        }),
      }),
    );
  });

  it("does not let older reference context prove a new claim by itself", async () => {
    const extractionRequest = request();
    extractionRequest.sourceMessages = [
      {
        id: "assistant-current",
        chatId: "chat-1",
        role: "assistant",
        content: "Okay.",
        characterId: "pierrot",
        createdAt: "2026-07-30T12:02:00.000Z",
        speakerLabel: "Pierrot",
      },
    ];
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway({
        memories: [
          {
            kind: "plot_state",
            content: "The circus accident injured three performers.",
            confidence: 0.91,
            evidence: "explicit_exchange",
            sourceMessageIds: ["assistant-current"],
            referenceMessageIds: ["user-reference"],
          },
        ],
      }),
      request: extractionRequest,
    });

    expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
  });

  describe("wording and format corrections", () => {
    const catRow = {
      id: "user-cat",
      chatId: "chat-1",
      role: "user",
      content: "i finally named the stray cat that hangs around my building. i named her Pickle",
      characterId: null,
      createdAt: "2026-07-30T12:01:00.000Z",
      speakerLabel: "Chai",
    };
    const named = "Chai named the stray cat that hangs around Chai's building Pickle.";

    function catRequest(): CanonicalConsequenceExtractionRequest {
      return { ...request(), userLabel: "Chai", sourceMessages: [catRow], referenceMessages: [] };
    }

    function catMemory(overrides: Record<string, unknown> = {}) {
      return {
        kind: "fact",
        content: named,
        confidence: 0.95,
        evidence: "direct_user_assertion",
        sourceMessageIds: ["user-cat"],
        ...overrides,
      };
    }

    function sequencedGateway(replies: Array<unknown>) {
      const prompts: string[] = [];
      const llm: LlmGateway = {
        async complete(llmRequest) {
          prompts.push(llmRequest.messages.map((message) => String(message.content)).join("\n"));
          const reply = replies.shift();
          if (reply instanceof Error) throw reply;
          return JSON.stringify(reply ?? {});
        },
        async *stream() {
          yield { type: "done" as const };
        },
        async listModels() {
          return [];
        },
      };
      return { llm, prompts };
    }

    it("corrects a third-person pronoun to the name and verifies the corrected wording", async () => {
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ content: "Chai named the stray cat that hangs around their building Pickle." })] },
        { corrections: [{ index: 0, content: named, confidence: 0.95 }] },
        { verdicts: [{ index: 0, faithful: true }] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result.candidates.map((memory) => memory.content)).toEqual([named]);
      expect(result.skippedCount).toBe(0);
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toContain(
        "Candidate 0 (fact): Chai named the stray cat that hangs around their building Pickle.",
      );
      expect(prompts[1]).toContain("problem: It uses a third-person personal pronoun.");
      expect(prompts[1]).toContain(`source user-cat | user | Chai | ${catRow.content}`);
      expect(prompts[2]).toContain(`Candidate 0 (fact): ${named}`);
    });

    it("corrects a word confidence into a number", async () => {
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ confidence: "high" })] },
        { corrections: [{ index: 0, content: named, confidence: 0.9 }] },
        { verdicts: [{ index: 0, faithful: true }] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result.candidates).toEqual([
        expect.objectContaining({ content: named, confidence: 0.9, status: "active" }),
      ]);
      expect(prompts[1]).toContain('confidence: "high"');
      expect(prompts[1]).toContain("problem: Its confidence is not a number from 0 to 1.");
    });

    it("lets a correction change only content and confidence", async () => {
      const { llm } = sequencedGateway([
        { memories: [catMemory({ confidence: "high" })] },
        {
          corrections: [
            {
              index: 0,
              content: named,
              confidence: 0.9,
              kind: "promise",
              evidence: "explicit_promise",
              sourceMessageIds: ["assistant-current"],
            },
          ],
        },
        { verdicts: [{ index: 0, faithful: true }] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result.candidates).toEqual([
        expect.objectContaining({
          kind: "fact",
          payload: expect.objectContaining({ evidence: "direct_user_assertion", sourceMessageIds: ["user-cat"] }),
        }),
      ]);
    });

    it("drops a correction that still breaks a rule without verifying it", async () => {
      const pronoun = "Chai named the stray cat that hangs around their building Pickle.";
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ content: pronoun })] },
        { corrections: [{ index: 0, content: pronoun, confidence: 0.95 }] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
      expect(prompts).toHaveLength(2);
    });

    it("drops a corrected name swap that the verifier rejects", async () => {
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ content: "Chai named the stray cat that hangs around their building Pickle." })] },
        {
          corrections: [
            {
              index: 0,
              content: "Chai named the stray cat that hangs around Pierrot's building Pickle.",
              confidence: 0.95,
            },
          ],
        },
        { verdicts: [{ index: 0, faithful: false }] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
      expect(prompts).toHaveLength(3);
    });

    it("keeps a candidate dropped when the correction reply has no usable entry for it", async () => {
      const { llm } = sequencedGateway([
        { memories: [catMemory({ confidence: "high" })] },
        {
          corrections: [
            { index: 1, content: named, confidence: 0.9 },
            { content: named, confidence: 0.9 },
          ],
        },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
    });

    it("does not ask for a correction when a candidate fails a substance check", async () => {
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ confidence: "high", sourceMessageIds: ["missing-row"] })] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result).toMatchObject({ candidates: [], skippedCount: 1 });
      expect(prompts).toHaveLength(1);
    });

    it("propagates a correction provider failure so the capture job retries", async () => {
      const { llm } = sequencedGateway([{ memories: [catMemory({ confidence: "high" })] }, new Error("provider down")]);

      await expect(extractCanonicalMemoryConsequences({ llm, request: catRequest() })).rejects.toThrow("provider down");
    });
  });
});

describe("automatic memory capture skip reasons", () => {
  function replies(...answers: unknown[]): LlmGateway {
    return {
      async complete() {
        return JSON.stringify(answers.shift() ?? {});
      },
      async *stream() {
        yield { type: "done" as const };
      },
      async listModels() {
        return [];
      },
    };
  }

  const miso = {
    kind: "fact",
    content: "Celia's cat is named Miso.",
    confidence: 0.95,
    evidence: "direct_user_assertion",
    sourceMessageIds: ["user-current"],
  };

  it.each([
    ["unknown_kind", { kind: "rumor" }],
    ["empty_content", { content: "   " }],
    ["too_long", { content: `Celia's cat is named Miso. ${"Miso naps. ".repeat(60)}` }],
    ["unknown_evidence", { evidence: "vibes" }],
    ["no_source_rows", { sourceMessageIds: [] }],
    ["unknown_source_row", { sourceMessageIds: ["user-elsewhere"] }],
    ["unknown_reference_row", { referenceMessageIds: ["user-elsewhere"] }],
    ["evidence_mismatch", { sourceMessageIds: ["assistant-current"] }],
    ["not_in_cited_rows", { content: "Celia owns a red bicycle." }],
    ["unknown_supersedes", { supersedesMemoryId: "memory-that-is-not-there" }],
  ])("records %s for a candidate that fails that check", async (reason, patch) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: replies({ memories: [{ ...miso, ...patch }] }),
      request: request(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ reason })]);
    expect(result.skippedCount).toBe(1);
    expect(result.proposedCount).toBe(1);
  });

  it("records a reply without a memories list, broken entries and entries past the limit", async () => {
    const empty = await extractCanonicalMemoryConsequences({ llm: replies({ facts: [] }), request: request() });
    expect(empty.skipped).toEqual([{ reason: "malformed_response" }]);

    const crowded = await extractCanonicalMemoryConsequences({
      llm: replies({ memories: ["not an object", ...Array.from({ length: 13 }, () => miso)] }),
      request: request(),
    });
    expect(crowded.proposedCount).toBe(14);
    expect(crowded.skipped.filter((skip) => skip.reason === "malformed_candidate")).toHaveLength(1);
    expect(crowded.skipped.filter((skip) => skip.reason === "over_limit")).toEqual([
      expect.objectContaining({ reason: "over_limit", content: miso.content, kind: "fact" }),
    ]);
    // The twelve that fit all pass; the persist step dedupes them later.
    expect(crowded.candidates).toHaveLength(12);
  });

  describe("label slip corrections", () => {
    function recording(...answers: unknown[]): { llm: LlmGateway; prompts: string[] } {
      const prompts: string[] = [];
      return {
        prompts,
        llm: {
          async complete(llmRequest) {
            prompts.push(llmRequest.messages.map((message) => message.content).join("\n"));
            return JSON.stringify(answers.shift() ?? {});
          },
          async *stream() {
            yield { type: "done" as const };
          },
          async listModels() {
            return [];
          },
        },
      };
    }

    it("relabels a kind and evidence slip once, then always verifies it", async () => {
      const slip = { ...miso, kind: "scene_event" };
      const { llm, prompts } = recording(
        { memories: [slip] },
        {
          corrections: [
            {
              index: 0,
              content: miso.content,
              confidence: 0.95,
              kind: "fact",
              evidence: "direct_user_assertion",
              sourceMessageIds: ["user-current"],
            },
          ],
        },
        { verdicts: [{ index: 0, faithful: true }] },
      );
      const result = await extractCanonicalMemoryConsequences({ llm, request: request() });

      expect(result.candidates).toEqual([expect.objectContaining({ kind: "fact", content: miso.content })]);
      expect(result.correctedCount).toBe(1);
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toContain("Its kind and evidence do not fit its cited rows.");
      expect(prompts[1]).toContain('evidence: "direct_user_assertion"');
      expect(prompts[2]).toContain("You verify saved memories");
    });

    it("lets a relabel drop cited rows but never add one", async () => {
      const both = { ...miso, sourceMessageIds: ["user-current", "assistant-current"] };
      const narrowed = await extractCanonicalMemoryConsequences({
        llm: replies(
          { memories: [both] },
          {
            corrections: [
              {
                index: 0,
                content: miso.content,
                confidence: 0.95,
                kind: "fact",
                evidence: "direct_user_assertion",
                sourceMessageIds: ["user-current", "user-reference"],
              },
            ],
          },
          { verdicts: [{ index: 0, faithful: true }] },
        ),
        request: request(),
      });
      expect(narrowed.candidates).toHaveLength(1);
      expect(narrowed.candidates[0]?.provenance.messageIds).toEqual(["user-current"]);

      const assistantOnly = { ...miso, sourceMessageIds: ["assistant-current"] };
      const added = await extractCanonicalMemoryConsequences({
        llm: replies(
          { memories: [assistantOnly] },
          {
            corrections: [
              {
                index: 0,
                content: miso.content,
                confidence: 0.95,
                kind: "fact",
                evidence: "direct_user_assertion",
                sourceMessageIds: ["user-current"],
              },
            ],
          },
        ),
        request: request(),
      });
      expect(added.candidates).toEqual([]);
      expect(added.skipped).toEqual([expect.objectContaining({ reason: "no_source_rows", afterCorrection: true })]);
    });

    it("keeps the evidence_mismatch reason when a label slip is not fixed", async () => {
      const slip = { ...miso, kind: "scene_event" };
      const missing = await extractCanonicalMemoryConsequences({
        llm: replies({ memories: [slip] }, { corrections: [] }),
        request: request(),
      });
      expect(missing.skipped).toEqual([expect.objectContaining({ reason: "evidence_mismatch" })]);

      const unchanged = await extractCanonicalMemoryConsequences({
        llm: replies({ memories: [slip] }, { corrections: [{ index: 0, content: miso.content, confidence: 0.95 }] }),
        request: request(),
      });
      expect(unchanged.skipped).toEqual([
        expect.objectContaining({ reason: "evidence_mismatch", afterCorrection: true }),
      ]);
    });
  });

  it("separates a missing correction, a still-broken correction and a verifier rejection", async () => {
    const pronoun = { ...miso, content: "Celia says her cat is named Miso." };

    const missing = await extractCanonicalMemoryConsequences({
      llm: replies({ memories: [pronoun] }, { corrections: [] }),
      request: request(),
    });
    expect(missing.skipped).toEqual([expect.objectContaining({ reason: "wording_uncorrected" })]);
    expect(missing.skipped[0]).not.toHaveProperty("afterCorrection");

    const stillBroken = await extractCanonicalMemoryConsequences({
      llm: replies({ memories: [pronoun] }, { corrections: [{ index: 0, content: pronoun.content, confidence: 0.9 }] }),
      request: request(),
    });
    expect(stillBroken.skipped).toEqual([
      expect.objectContaining({ reason: "wording_uncorrected", afterCorrection: true }),
    ]);

    const rejected = await extractCanonicalMemoryConsequences({
      llm: replies(
        { memories: [pronoun] },
        { corrections: [{ index: 0, content: "Celia says Celia's cat is named Miso.", confidence: 0.9 }] },
        { verdicts: [{ index: 0, faithful: false }] },
      ),
      request: request(),
    });
    expect(rejected.skipped).toEqual([expect.objectContaining({ reason: "verifier_rejected", afterCorrection: true })]);
  });

  it("says when the verifier's answer was unusable instead of calling it a rejection", async () => {
    const paraphrase = { ...miso, content: "Celia has a cat called Miso." };
    const result = await extractCanonicalMemoryConsequences({
      llm: replies({ memories: [paraphrase] }, { verdicts: [{ index: 3, faithful: true }] }),
      request: request(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ reason: "verifier_unusable" })]);
  });

  it("counts a corrected memory that the verifier keeps", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: replies(
        { memories: [{ ...miso, confidence: "high" }] },
        { corrections: [{ index: 0, content: miso.content, confidence: 0.9 }] },
        { verdicts: [{ index: 0, faithful: true }] },
      ),
      request: request(),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.correctedCount).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("reports low-value, duplicate and low-confidence memories in the job report", () => {
    const candidate = (content: string) => ({
      kind: "fact" as const,
      status: "active" as const,
      scope: { kind: "character" as const, id: "pierrot" },
      content,
      confidence: 0.9,
      provenance: { sourceChatId: "chat-1", messageIds: ["user-current"], characterId: null, timestamp: null },
      title: null,
      tags: [],
      supersedesMemoryId: null,
      payload: {},
    });
    const saved = (id: string, status: "active" | "stale") => ({
      operation: "created" as const,
      memory: { ...candidate(id), id, status, createdAt: "", updatedAt: "" },
    });

    const report = buildMemoryCaptureReport({
      extraction: {
        skipped: [{ reason: "verifier_rejected", content: "Celia hates Miso." }],
        proposedCount: 5,
        correctedCount: 1,
      },
      lowValue: [candidate("Celia said hello.")],
      duplicates: [candidate("Celia's cat is named Miso.")],
      affected: [saved("memory-1", "active"), saved("memory-2", "stale")],
      transcriptCandidate: true,
      transcriptAccepted: false,
    });

    expect(report).toEqual({
      version: 1,
      proposed: 5,
      saved: 1,
      savedInactive: 1,
      corrected: 1,
      skippedTotal: 3,
      skipped: [
        { reason: "verifier_rejected", content: "Celia hates Miso." },
        { reason: "low_value", kind: "fact", content: "Celia said hello." },
        { reason: "duplicate", kind: "fact", content: "Celia's cat is named Miso." },
      ],
      transcript: "low_value",
    });
  });
});

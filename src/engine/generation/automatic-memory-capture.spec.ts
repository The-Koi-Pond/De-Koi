import { describe, expect, it } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import {
  automaticCaptureMemoryFailure,
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

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

      expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

      expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

      expect(result).toEqual({ candidates: [], skippedCount: 1 });
    });

    it("does not ask for a correction when a candidate fails a substance check", async () => {
      const { llm, prompts } = sequencedGateway([
        { memories: [catMemory({ confidence: "high", sourceMessageIds: ["missing-row"] })] },
      ]);

      const result = await extractCanonicalMemoryConsequences({ llm, request: catRequest() });

      expect(result).toEqual({ candidates: [], skippedCount: 1 });
      expect(prompts).toHaveLength(1);
    });

    it("propagates a correction provider failure so the capture job retries", async () => {
      const { llm } = sequencedGateway([{ memories: [catMemory({ confidence: "high" })] }, new Error("provider down")]);

      await expect(extractCanonicalMemoryConsequences({ llm, request: catRequest() })).rejects.toThrow("provider down");
    });
  });
});

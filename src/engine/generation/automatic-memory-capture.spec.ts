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
});

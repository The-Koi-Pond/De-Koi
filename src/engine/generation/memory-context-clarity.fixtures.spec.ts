import { describe, expect, it } from "vitest";

import type { LlmGateway } from "../capabilities/llm";
import {
  extractCanonicalMemoryConsequences,
  type CanonicalConsequenceExtractionRequest,
} from "./automatic-memory-capture";
import { resolveMemoryUserIdentity } from "./memory-prompt-content";

function gateway(memories: unknown[]): LlmGateway {
  return {
    async complete() {
      return JSON.stringify({ memories });
    },
    async *stream() {
      yield { type: "done" as const };
    },
    async listModels() {
      return [];
    },
  };
}

function request(
  userLabel: string,
  sourceMessages: CanonicalConsequenceExtractionRequest["sourceMessages"],
  referenceMessages: CanonicalConsequenceExtractionRequest["referenceMessages"] = [],
): CanonicalConsequenceExtractionRequest {
  return {
    version: 1,
    jobId: "fixture-job",
    chatId: "fixture-chat",
    mode: "conversation",
    scope: { kind: "character", id: "pierrot" },
    activeCharacterId: "pierrot",
    userLabel,
    characterLabels: { pierrot: "Pierrot" },
    sourceMessages,
    referenceMessages,
    eligibleMemories: [],
    connectionId: "connection-1",
  };
}

const timestamp = "2026-07-30T12:00:00.000Z";

describe("memory context clarity semantic fixtures", () => {
  it.each([
    {
      label: "named user",
      userLabel: "Celia",
      source: {
        id: "user-current",
        chatId: "fixture-chat",
        role: "user",
        content: "My cat is Miso.",
        characterId: null,
        createdAt: timestamp,
        speakerLabel: "Celia",
      },
      candidate: {
        kind: "fact",
        content: "Celia's cat is named Miso.",
        confidence: 0.95,
        evidence: "direct_user_assertion",
        sourceMessageIds: ["user-current"],
      },
    },
    {
      label: "user macro",
      userLabel: "{{user}}",
      source: {
        id: "user-current",
        chatId: "fixture-chat",
        role: "user",
        content: "My cat is Miso.",
        characterId: null,
        createdAt: timestamp,
        speakerLabel: "{{user}}",
      },
      candidate: {
        kind: "fact",
        content: "{{user}}'s cat is named Miso.",
        confidence: 0.95,
        evidence: "direct_user_assertion",
        sourceMessageIds: ["user-current"],
      },
    },
    {
      label: "named character",
      userLabel: "Celia",
      source: {
        id: "assistant-current",
        chatId: "fixture-chat",
        role: "assistant",
        content: "I will return.",
        characterId: "pierrot",
        createdAt: timestamp,
        speakerLabel: "Pierrot",
      },
      candidate: {
        kind: "promise",
        content: "Pierrot promised to return.",
        confidence: 0.95,
        evidence: "explicit_promise",
        sourceMessageIds: ["assistant-current"],
      },
    },
  ])("accepts the supported standalone $label fixture", async ({ userLabel, source, candidate }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request(userLabel, [source]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("resolves a vague topic only when the cited context names it", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Pierrot does not want to discuss the circus accident.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-current"],
          referenceMessageIds: ["user-reference"],
        },
        {
          kind: "plot_state",
          content: "Pierrot said he does not want to talk about it.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-current"],
          referenceMessageIds: ["user-reference"],
        },
      ]),
      request: request(
        "Celia",
        [
          {
            id: "assistant-current",
            chatId: "fixture-chat",
            role: "assistant",
            content: "I do not want to talk about it.",
            characterId: "pierrot",
            createdAt: "2026-07-30T12:01:00.000Z",
            speakerLabel: "Pierrot",
          },
        ],
        [
          {
            id: "user-reference",
            chatId: "fixture-chat",
            role: "user",
            content: "Do you mean the circus accident?",
            characterId: null,
            createdAt: timestamp,
            speakerLabel: "Celia",
          },
        ],
      ),
    });

    expect(result.skippedCount).toBe(1);
    expect(result.candidates.map((memory) => memory.content)).toEqual([
      "Pierrot does not want to discuss the circus accident.",
    ]);
  });

  it("resolves only the user token when a persona exists", () => {
    const stored = "{{user}} likes tea beside {{char}} and {{setvar::x::bad}}.";
    expect(resolveMemoryUserIdentity(stored, "Celia")).toBe("Celia likes tea beside {{char}} and {{setvar::x::bad}}.");
    expect(resolveMemoryUserIdentity(stored, null)).toBe(stored);
  });
});

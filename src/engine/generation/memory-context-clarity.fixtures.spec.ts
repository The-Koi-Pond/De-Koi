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

  it("rejects a candidate that says Shlo made Agent Cobalt's promise", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "promise",
          content: "Shlo promised to wait at the east gate.",
          confidence: 0.95,
          evidence: "explicit_promise",
          sourceMessageIds: ["assistant-cobalt"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "assistant-cobalt",
          chatId: "fixture-chat",
          role: "assistant",
          content: "I promise I will wait at the east gate.",
          characterId: "cobalt",
          createdAt: timestamp,
          speakerLabel: "Agent Cobalt",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a named commitment without same-speaker commitment-act evidence", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "promise",
          content: "Shlo promised to wait at the east gate.",
          confidence: 0.95,
          evidence: "explicit_promise",
          sourceMessageIds: ["user-shlo", "assistant-cobalt"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "The east gate is rusty.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
        {
          id: "assistant-cobalt",
          chatId: "fixture-chat",
          role: "assistant",
          content: "I will wait at the east gate.",
          characterId: "cobalt",
          createdAt: timestamp,
          speakerLabel: "Agent Cobalt",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a named commitment with the wrong same-speaker action", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "promise",
          content: "Shlo promised to wait at the east gate.",
          confidence: 0.95,
          evidence: "explicit_promise",
          sourceMessageIds: ["user-shlo"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "I will inspect the east gate.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each(["I did not promise to wait at the east gate.", "I will not wait at the east gate."])(
    "rejects a positive promise from negative evidence: %s",
    async (sourceContent) => {
      const result = await extractCanonicalMemoryConsequences({
        llm: gateway([
          {
            kind: "promise",
            content: "Shlo promised to wait at the east gate.",
            confidence: 0.95,
            evidence: "explicit_promise",
            sourceMessageIds: ["user-shlo"],
          },
        ]),
        request: request("Shlo", [
          {
            id: "user-shlo",
            chatId: "fixture-chat",
            role: "user",
            content: sourceContent,
            characterId: null,
            createdAt: timestamp,
            speakerLabel: "Shlo",
          },
        ]),
      });

      expect(result).toEqual({ candidates: [], skippedCount: 1 });
    },
  );

  it("accepts a negative promise from matching future-negative evidence", async () => {
    const candidate = {
      kind: "promise",
      content: "Shlo promised not to wait at the east gate.",
      confidence: 0.95,
      evidence: "explicit_promise",
      sourceMessageIds: ["user-shlo"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "I will not wait at the east gate.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("requires speaker-local support for an according-to frame", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "According to Shlo, the returned Machina has a brass crown.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["user-shlo", "assistant-cobalt"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "The east gate is rusty.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
        {
          id: "assistant-cobalt",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The returned Machina has a brass crown.",
          characterId: "cobalt",
          createdAt: timestamp,
          speakerLabel: "Agent Cobalt",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects an according-to frame with only topical speaker overlap", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "According to Shlo, the east gate is locked.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["user-shlo"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "The east gate is rusty.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a positive attribution from negative evidence", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "According to Shlo, the east gate is locked.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["user-shlo"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "The east gate is not locked.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("accepts an according-to frame supported by that speaker", async () => {
    const candidate = {
      kind: "plot_state",
      content: "According to Shlo, the east gate is locked.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["user-shlo"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Shlo", [
        {
          id: "user-shlo",
          chatId: "fixture-chat",
          role: "user",
          content: "The east gate is locked.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("rejects an unsupported participant in a compound reporting subject", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Shlo and Agent Cobalt discussed returned Machina.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-cobalt"],
        },
      ]),
      request: request("Shlo", [
        {
          id: "assistant-cobalt",
          chatId: "fixture-chat",
          role: "assistant",
          content: "I discussed returned Machina.",
          characterId: "cobalt",
          createdAt: timestamp,
          speakerLabel: "Agent Cobalt",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a general rule inferred from one returned-Machina observation", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Returned Machinas have brass crowns.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The returned Machina has one brass crown.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects class-wide subject drift even when a local quantifier remains", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Returned Machinas each have one brass crown.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The returned Machina has one brass crown.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects class-wide subject drift without relying on a candidate verb cue", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Returned Machinas possess one brass crown.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The returned Machina has one brass crown.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects class-wide drift from an article-scoped singular observation", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Returned Machinas have brass crowns.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "A returned Machina has a brass crown.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects irregular singular-to-class drift when another one remains", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "People carry one brass key.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-person"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-person",
          chatId: "fixture-chat",
          role: "assistant",
          content: "One person carries one brass key.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "cities",
      source: "A red city has one stone gate.",
      candidate: "Red cities have one stone gate.",
    },
    {
      label: "boxes",
      source: "A wooden box has one brass latch.",
      candidate: "Wooden boxes have one brass latch.",
    },
    {
      label: "oxen",
      source: "A red ox has one silver bell.",
      candidate: "Red oxen have one silver bell.",
    },
    {
      label: "same-form fish",
      source: "A silver fish has one red fin.",
      candidate: "Silver fish have one red fin.",
    },
    {
      label: "same-form fish with an article",
      source: "A silver fish has one red fin.",
      candidate: "The silver fish have one red fin.",
    },
    {
      label: "same-form fish with an intervening adverb",
      source: "A silver fish has one red fin.",
      candidate: "Silver fish generally have one red fin.",
    },
  ])("rejects $label singular-to-class morphology", async ({ source, candidate }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-observation"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-observation",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects moving demonstrative scope to a different local noun", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The returned Machina waits at this gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "This returned Machina waits at the east gate.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects laundering a moved scope through one shared binding token", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The returned gate waits beside this Machina.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "This returned Machina waits at the east gate.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects laundering a moved scope through shared modifiers", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The ancient red Machina guards this ancient red gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "This ancient red Machina guards the east gate.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects laundering a moved scope when extra modifiers push the source head out", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The very ancient red Machina guards this very ancient red gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-machina"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "This very ancient red Machina guards the east gate.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("accepts a candidate that preserves the cited observation's explicit scope", async () => {
    const candidate = {
      kind: "plot_state",
      content: "One returned Machina has one brass crown.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["assistant-machina"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The returned Machina has one brass crown.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("does not apply specificity from an unrelated evidence clause", async () => {
    const candidate = {
      kind: "plot_state",
      content: "Returned Machinas have brass crowns.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["assistant-machina"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "assistant-machina",
          chatId: "fixture-chat",
          role: "assistant",
          content: "I saw one silver bird. Returned Machinas have brass crowns.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("does not treat a complementizer that as demonstrative scope", async () => {
    const candidate = {
      kind: "fact",
      content: "Celia knows Miso is hungry.",
      confidence: 0.95,
      evidence: "direct_user_assertion",
      sourceMessageIds: ["user-current"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "user-current",
          chatId: "fixture-chat",
          role: "user",
          content: "I know that Miso is hungry.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Celia",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("accepts a candidate that preserves determiner that scope", async () => {
    const candidate = {
      kind: "preference",
      content: "Celia likes that room.",
      confidence: 0.95,
      evidence: "direct_user_assertion",
      sourceMessageIds: ["user-current"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "user-current",
          chatId: "fixture-chat",
          role: "user",
          content: "I like that room.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Celia",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it("treats direct-object that as demonstrative scope", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "fact",
          content: "Celia remembers the room.",
          confidence: 0.95,
          evidence: "direct_user_assertion",
          sourceMessageIds: ["user-current"],
        },
      ]),
      request: request("Celia", [
        {
          id: "user-current",
          chatId: "fixture-chat",
          role: "user",
          content: "I remember that room.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Celia",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

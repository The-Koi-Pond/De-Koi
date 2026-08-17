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

  it.each(["I didn't promise to wait at the east gate.", "I cannot promise to wait at the east gate."])(
    "rejects a negative promise from a negated commitment act: %s",
    async (sourceContent) => {
      const result = await extractCanonicalMemoryConsequences({
        llm: gateway([
          {
            kind: "promise",
            content: "Shlo promised not to wait at the east gate.",
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

  it("rejects a promise inferred from refusing to make that commitment", async () => {
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
          content: "I refused to promise to wait at the east gate.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
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

  it("rejects coordinated attribution claims whose proposition polarities are inverted", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "According to Shlo, the east gate is locked and the west gate is not open.",
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
          content: "The east gate is not locked and the west gate is open.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Shlo",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a direct claim whose evidence has opposite polarity", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The east gate is locked.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-gate"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-gate",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The east gate is not locked.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a direct claim with an unsupported surface predicate", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "relationship_state",
          content: "Mira trusts Celia.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-mira"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-mira",
          chatId: "fixture-chat",
          role: "assistant",
          content: "Mira distrusts Celia.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "opposite-polarity predicate with extra topic overlap",
      source: "Mira distrusts Celia about the east gate.",
      candidate: "Mira trusts Celia about the east gate.",
    },
    {
      label: "same-polarity predicate with extra topic overlap",
      source: "Mira avoids Celia by the east gate.",
      candidate: "Mira trusts Celia by the east gate.",
    },
  ])("rejects $label", async ({ source, candidate }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "relationship_state",
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-mira"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-mira",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "changed gate predicate",
      source: "East Gate is open.",
      candidate: "East Gate is locked.",
    },
    {
      label: "changed Machina predicate",
      source: "Returned Machina is friendly.",
      candidate: "Returned Machina is hostile.",
    },
  ])("rejects $label despite a matching subject", async ({ source, candidate }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-state"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-state",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a negative predicate when its material object changed", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "relationship_state",
          content: "Mira does not trust Celia.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-mira"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-mira",
          chatId: "fixture-chat",
          role: "assistant",
          content: "Mira distrusts the east gate near Celia.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("accepts equivalent negative predicates with the same material object", async () => {
    const candidate = {
      kind: "relationship_state",
      content: "Mira does not trust Celia.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["assistant-mira"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "assistant-mira",
          chatId: "fixture-chat",
          role: "assistant",
          content: "Mira distrusts Celia.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
  });

  it.each([
    {
      label: "destroyed key from left-it evidence",
      source: "I left it at the east gate.",
      candidate: "The silver key was destroyed at the east gate.",
    },
    {
      label: "exploded crown from kept-it evidence",
      source: "I kept it near the east gate.",
      candidate: "The brass crown exploded near the east gate.",
    },
  ])("rejects $label", async ({ source, candidate }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-event"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-event",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects a claim that reverses material argument roles", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "scene_event",
          content: "The guard moved the brass vault from the east gate to the silver key.",
          confidence: 0.95,
          evidence: "explicit_screen_event",
          sourceMessageIds: ["assistant-move"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-move",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The guard moved the silver key from the east gate to the brass vault.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects replacing a material asked predicate with warned", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "Mira warned Celia about the east gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-mira"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-mira",
          chatId: "fixture-chat",
          role: "assistant",
          content: "Mira asked Celia about the east gate.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects replacing a material discussed predicate with prefers", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "preference",
          content: "Celia prefers tea.",
          confidence: 0.95,
          evidence: "direct_user_assertion",
          sourceMessageIds: ["user-celia"],
        },
      ]),
      request: request("Celia", [
        {
          id: "user-celia",
          chatId: "fixture-chat",
          role: "user",
          content: "I discussed tea.",
          characterId: null,
          createdAt: timestamp,
          speakerLabel: "Celia",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects candidate details that are not proved while resolving it", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The brass crown, previously stolen, was kept near the east gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-event"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-event",
          chatId: "fixture-chat",
          role: "assistant",
          content: "I kept it near the east gate.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("rejects reversed roles in a material naming predicate", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "relationship_state",
          content: "The scout named the guard captain.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-naming"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-naming",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The guard named the scout captain.",
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "curly isn't",
      source: "The east gate isn’t locked.",
      candidate: "The east gate is locked.",
      kind: "plot_state" as const,
    },
    {
      label: "curly can't",
      source: "Mira can’t trust Celia.",
      candidate: "Mira trusts Celia.",
      kind: "relationship_state" as const,
    },
  ])("rejects dropping negative polarity from $label evidence", async ({ source, candidate, kind }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind,
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-negative"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-negative",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "might",
      source: "The east gate might be locked.",
      candidate: "The east gate is locked.",
      kind: "plot_state" as const,
    },
    {
      label: "could",
      source: "Mira could trust Celia.",
      candidate: "Mira trusts Celia.",
      kind: "relationship_state" as const,
    },
  ])("rejects dropping $label modality", async ({ source, candidate, kind }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind,
          content: candidate,
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-modal"],
        },
      ]),
      request: request("Celia", [
        {
          id: "assistant-modal",
          chatId: "fixture-chat",
          role: "assistant",
          content: source,
          characterId: "mira",
          createdAt: timestamp,
          speakerLabel: "Mira",
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "a source condition",
      source: "If the alarm sounds, the east gate is locked.",
      candidate: "The east gate is locked.",
      kind: "plot_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "future tense",
      source: "East Gate will be locked.",
      candidate: "East Gate is locked.",
      kind: "plot_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "probability",
      source: "East Gate is probably locked.",
      candidate: "East Gate is locked.",
      kind: "plot_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "seeming",
      source: "East Gate seems locked.",
      candidate: "East Gate is locked.",
      kind: "plot_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "a shared talk prefix",
      source: "I discussed plans.",
      candidate: "Celia is talkative about plans.",
      kind: "preference" as const,
      role: "user" as const,
      speakerLabel: "Celia",
    },
  ])("rejects dropping or replacing $label", async ({ source, candidate, kind, role, speakerLabel }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind,
          content: candidate,
          confidence: 0.95,
          evidence: role === "user" ? "direct_user_assertion" : "explicit_exchange",
          sourceMessageIds: ["source-material"],
        },
      ]),
      request: request("Celia", [
        {
          id: "source-material",
          chatId: "fixture-chat",
          role,
          content: source,
          characterId: role === "assistant" ? "mira" : null,
          createdAt: timestamp,
          speakerLabel,
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("uses reference context only for an unresolved antecedent identity", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The brass crown that was stolen yesterday was kept near the east gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-event"],
          referenceMessageIds: ["assistant-reference"],
        },
      ]),
      request: request(
        "Celia",
        [
          {
            id: "assistant-event",
            chatId: "fixture-chat",
            role: "assistant",
            content: "I kept it near the east gate.",
            characterId: "mira",
            createdAt: timestamp,
            speakerLabel: "Mira",
          },
        ],
        [
          {
            id: "assistant-reference",
            chatId: "fixture-chat",
            role: "assistant",
            content: "The brass crown was stolen yesterday.",
            characterId: "mira",
            createdAt: timestamp,
            speakerLabel: "Mira",
          },
        ],
      ),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it.each([
    {
      label: "a changed direct subject",
      source: "Mira trusts Shlo.",
      candidate: "Pierrot trusts Shlo.",
      kind: "relationship_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "a changed preference subject",
      source: "Please keep the room quiet.",
      candidate: "Mira prefers the room kept quiet.",
      kind: "preference" as const,
      role: "user" as const,
      speakerLabel: "Celia",
    },
    {
      label: "changed copula tense",
      source: "Mira was friendly to Shlo.",
      candidate: "Mira is friendly to Shlo.",
      kind: "relationship_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "changed lexical verb tense",
      source: "Mira trusted Shlo.",
      candidate: "Mira trusts Shlo.",
      kind: "relationship_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
    {
      label: "a short source condition",
      source: "If so, East Gate is locked.",
      candidate: "East Gate is locked.",
      kind: "plot_state" as const,
      role: "assistant" as const,
      speakerLabel: "Mira",
    },
  ])("rejects $label", async ({ source, candidate, kind, role, speakerLabel }) => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind,
          content: candidate,
          confidence: 0.95,
          evidence: role === "user" ? "direct_user_assertion" : "explicit_exchange",
          sourceMessageIds: ["source-structure"],
        },
      ]),
      request: request("Celia", [
        {
          id: "source-structure",
          chatId: "fixture-chat",
          role,
          content: source,
          characterId: role === "assistant" ? "mira" : null,
          createdAt: timestamp,
          speakerLabel,
        },
      ]),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("does not import a referenced predicate into an unresolved antecedent", async () => {
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([
        {
          kind: "plot_state",
          content: "The brass crown that exploded yesterday was kept near the east gate.",
          confidence: 0.95,
          evidence: "explicit_exchange",
          sourceMessageIds: ["assistant-event"],
          referenceMessageIds: ["assistant-reference"],
        },
      ]),
      request: request(
        "Celia",
        [
          {
            id: "assistant-event",
            chatId: "fixture-chat",
            role: "assistant",
            content: "I kept it near the east gate.",
            characterId: "mira",
            createdAt: timestamp,
            speakerLabel: "Mira",
          },
        ],
        [
          {
            id: "assistant-reference",
            chatId: "fixture-chat",
            role: "assistant",
            content: "Brass crown exploded yesterday.",
            characterId: "mira",
            createdAt: timestamp,
            speakerLabel: "Mira",
          },
        ],
      ),
    });

    expect(result).toEqual({ candidates: [], skippedCount: 1 });
  });

  it("accepts a direct claim whose evidence has matching negative polarity", async () => {
    const candidate = {
      kind: "plot_state",
      content: "The east gate is not locked.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["assistant-gate"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "assistant-gate",
          chatId: "fixture-chat",
          role: "assistant",
          content: "The east gate is not locked.",
          characterId: "pierrot",
          createdAt: timestamp,
          speakerLabel: "Pierrot",
        },
      ]),
    });

    expect(result.candidates.map((memory) => memory.content)).toEqual([candidate.content]);
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
    {
      label: "heroes without morphology assumptions",
      source: "A red hero has one silver bell.",
      candidate: "Red heroes have one silver bell.",
    },
    {
      label: "unlisted same-form moose",
      source: "A silver moose has one red tag.",
      candidate: "Silver moose generally have one red tag.",
    },
    {
      label: "agreement-only unlisted same-form moose",
      source: "Silver moose has one red tag.",
      candidate: "Silver moose generally have one red tag.",
    },
    {
      label: "unlisted noun with lexical agreement",
      source: "A silver moose carries one red tag.",
      candidate: "Silver moose generally carry one red tag.",
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

  it("accepts an article-scoped candidate that preserves the same singular subject", async () => {
    const candidate = {
      kind: "plot_state",
      content: "One red hero has one silver bell.",
      confidence: 0.95,
      evidence: "explicit_exchange",
      sourceMessageIds: ["assistant-hero"],
    };
    const result = await extractCanonicalMemoryConsequences({
      llm: gateway([candidate]),
      request: request("Celia", [
        {
          id: "assistant-hero",
          chatId: "fixture-chat",
          role: "assistant",
          content: "A red hero has one silver bell.",
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

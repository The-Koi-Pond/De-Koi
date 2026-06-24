import { describe, expect, it } from "vitest";

import type { GenerationContextAttributionItem } from "../contracts/types/chat";
import {
  attributionForAgentInjections,
  attributionForChatHistory,
  attributionForChatSummary,
  attributionForLorebookEntries,
  attributionForMemoryRecall,
  generationContextAttribution,
} from "./context-attribution";

describe("generation context attribution", () => {
  it("records injected memory chunks without changing the prompt block", () => {
    const result = attributionForMemoryRecall({
      packedLines: [
        "Celia promised to meet Deki at the koi pond after sundown.",
        "The party learned the gate password is moonlit tea.",
      ],
      recalled: [
        { content: "Celia promised to meet Deki at the koi pond after sundown.", similarity: 0.82, lexicalScore: 4 },
        { content: "The party learned the gate password is moonlit tea.", similarity: 0.61, lexicalScore: 3 },
      ],
      consideredCount: 12,
    });

    expect(result.promptLines).toEqual([
      "Celia promised to meet Deki at the koi pond after sundown.",
      "The party learned the gate password is moonlit tea.",
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        kind: "memory_recall",
        label: "Memory 1",
        status: "injected",
        snippet: "Celia promised to meet Deki at the koi pond after sundown.",
        metadata: expect.objectContaining({ rank: 1, consideredCount: 12 }),
      }),
      expect.objectContaining({
        kind: "memory_recall",
        label: "Memory 2",
        status: "injected",
        snippet: "The party learned the gate password is moonlit tea.",
        metadata: expect.objectContaining({ rank: 2, consideredCount: 12 }),
      }),
    ]);
  });

  it("summarizes lorebook entries from activated prompt assembly entries", () => {
    const items = attributionForLorebookEntries([
      {
        id: "entry-1",
        lorebookId: "lore-1",
        name: "Moon Gate",
        content: "The moon gate opens only after the third bell.",
        tag: "world_info_before",
        matchedKeys: ["gate", "moon"],
        order: 4,
        constant: false,
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        kind: "lorebook",
        label: "Moon Gate",
        status: "injected",
        sourceId: "entry-1",
        sourceCollection: "lorebook_entries",
        parentSourceId: "lore-1",
        snippet: "The moon gate opens only after the third bell.",
        metadata: expect.objectContaining({ matchedKeys: ["gate", "moon"], tag: "world_info_before" }),
      }),
    ]);
  });

  it("redacts hidden agent injections while preserving visible attribution", () => {
    const items = attributionForAgentInjections([
      {
        agentType: "knowledge-router",
        agentName: "Knowledge Router",
        text: "Injected lorebook entry: Moon Gate.",
      },
      {
        agentType: "secret_plot",
        agentName: "Secret Plot",
        text: "The villain is secretly present in this scene.",
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        kind: "knowledge_router",
        label: "Knowledge Router",
        status: "injected",
        snippet: "Injected lorebook entry: Moon Gate.",
        metadata: expect.objectContaining({ redacted: false }),
      }),
      expect.objectContaining({
        kind: "agent_injection",
        label: "Secret Plot",
        status: "redacted",
        snippet: null,
        metadata: expect.objectContaining({ agentType: "secret_plot", redacted: true }),
      }),
    ]);
  });

  it("records chat history continuity with hidden and limit-skipped counts", () => {
    const items = attributionForChatHistory({
      included: [
        {
          role: "user",
          name: "Celia",
          characterId: "persona-1",
          content: "Remember the moon gate password.",
        },
        {
          role: "assistant",
          name: "Deki",
          characterId: "char-1",
          content: "The password is moonlit tea.",
        },
      ],
      hiddenFromAiCount: 1,
      skippedByLimitCount: 3,
      requestedLimit: 2,
    });

    expect(items).toEqual([
      expect.objectContaining({
        kind: "chat_history",
        label: "Celia",
        status: "injected",
        sourceId: "persona-1",
        snippet: "Remember the moon gate password.",
        metadata: expect.objectContaining({ role: "user", rank: 1, requestedLimit: 2 }),
      }),
      expect.objectContaining({
        kind: "chat_history",
        label: "Deki",
        status: "injected",
        sourceId: "char-1",
        snippet: "The password is moonlit tea.",
        metadata: expect.objectContaining({ role: "assistant", rank: 2, requestedLimit: 2 }),
      }),
      expect.objectContaining({
        kind: "chat_history",
        label: "1 hidden from AI",
        status: "skipped",
        snippet: null,
        metadata: expect.objectContaining({ reason: "hidden_from_ai", count: 1 }),
      }),
      expect.objectContaining({
        kind: "chat_history",
        label: "3 skipped by history limit",
        status: "skipped",
        snippet: null,
        metadata: expect.objectContaining({ reason: "history_limit", count: 3, requestedLimit: 2 }),
      }),
    ]);
  });

  it("records injected chat summary continuity", () => {
    expect(attributionForChatSummary("Celia and Deki agreed to meet at the koi pond.")).toEqual([
      expect.objectContaining({
        kind: "chat_summary",
        label: "Chat Summary",
        status: "injected",
        snippet: "Celia and Deki agreed to meet at the koi pond.",
      }),
    ]);
    expect(attributionForChatSummary("   ")).toEqual([]);
  });
  it("omits empty attributions from saved snapshots", () => {
    const attribution = generationContextAttribution([
      [],
      [null, undefined, false as unknown as GenerationContextAttributionItem],
      attributionForAgentInjections([{ agentType: "director", text: "Keep the scene tense." }]),
    ]);

    expect(attribution).toEqual({
      source: "saved_snapshot",
      items: [
        expect.objectContaining({
          kind: "agent_injection",
          label: "Director",
          status: "injected",
          snippet: "Keep the scene tense.",
        }),
      ],
    });
  });
});

import { describe, expect, it } from "vitest";
import { BUILT_IN_AGENT_IDS, EDITABLE_CHARACTER_CARD_FIELDS, type AgentContext } from "../../contracts/types/agent";
import type { BaseLLMProvider, ChatMessage } from "../../generation-core/llm/base-provider";
import { executeAgent, executeAgentBatch, type AgentExecConfig } from "./agent-executor";
import { loreFieldsForAgentTypes } from "./agent-context-profile";

const EXPECTED_PROFILE_MEMBERS = {
  full: ["card-evolution-auditor", "prompt-reviewer", "editor", "secret-plot-driver"],
  narrative: [
    "director",
    "prose-guardian",
    "continuity",
    "cyoa",
    "echo-chamber",
    "lorebook-keeper",
    "knowledge-retrieval",
    "knowledge-router",
  ],
  visual: ["expression", "illustrator", "background"],
  state: ["world-state", "quest", "combat", "character-tracker", "persona-stats", "custom-tracker"],
  music: ["music-dj", "spotify", "schedule-planner", "response-orchestrator", "autonomous-messenger"],
  minimal: ["html", "chat-summary"],
} as const;

const EDITABLE_FIELD_TO_LORE_FIELD = {
  description: "description",
  personality: "personality",
  scenario: "scenario",
  first_mes: "firstMes",
  mes_example: "mesExample",
  creator_notes: "creatorNotes",
  system_prompt: "systemPrompt",
  post_history_instructions: "postHistoryInstructions",
  backstory: "backstory",
  appearance: "appearance",
} as const;

const CARD_FIELD_VALUES = {
  description: "DESCRIPTION_".repeat(80),
  personality: "PERSONALITY_".repeat(80),
  scenario: "SCENARIO_".repeat(80),
  firstMes: "FIRST_MES_".repeat(80),
  mesExample: "MES_EXAMPLE_".repeat(80),
  creatorNotes: "CREATOR_NOTES_".repeat(80),
  systemPrompt: "SYSTEM_PROMPT_".repeat(80),
  postHistoryInstructions: "POST_HISTORY_".repeat(80),
  backstory: "BACKSTORY_".repeat(80),
  appearance: "APPEARANCE_".repeat(80),
} as const;

function richContext(): AgentContext {
  return {
    chatId: "chat-1",
    chatMode: "roleplay",
    recentMessages: [],
    mainResponse: null,
    gameState: null,
    characters: [{ id: "char-1", name: "Mira", ...CARD_FIELD_VALUES }],
    persona: {
      name: "Traveler",
      description: "PERSONA_DESCRIPTION_".repeat(40),
      personality: "PERSONA_PERSONALITY_".repeat(40),
      scenario: "PERSONA_SCENARIO_".repeat(40),
      backstory: "PERSONA_BACKSTORY_".repeat(40),
      appearance: "PERSONA_APPEARANCE_".repeat(40),
      personaStats: { enabled: true, bars: [{ name: "Energy", value: 4, max: 10, color: "blue" }] },
      rpgStats: { enabled: true, attributes: [{ name: "Focus", value: 8 }], hp: { value: 9, max: 10 } },
    },
    memory: {},
    activatedLorebookEntries: null,
    writableLorebookIds: null,
    chatSummary: null,
    streaming: false,
  };
}

function config(type: string): AgentExecConfig {
  return {
    id: type,
    type,
    name: type,
    phase: "post_processing",
    promptTemplate: `Return the ${type} result.`,
    connectionId: null,
    settings: {},
  };
}

async function captureSystemPrompt(type: string): Promise<string> {
  let captured: ChatMessage[] = [];
  const provider: BaseLLMProvider = {
    maxTokensOverrideValue: null,
    async chatComplete(messages) {
      if (captured.length === 0) captured = messages;
      return { content: type === "expression" ? "{}" : "ok" };
    },
  };

  await executeAgent(config(type), richContext(), provider, "test-model");
  return captured.find((message) => message.role === "system")?.content ?? "";
}

describe("agent lore context profiles", () => {
  it("assigns every built-in agent ID to exactly one explicit profile", () => {
    const profiledIds = Object.values(EXPECTED_PROFILE_MEMBERS).flat().sort();
    const builtInIds = Object.values(BUILT_IN_AGENT_IDS).sort();

    expect(profiledIds).toEqual(builtInIds);
    for (const id of builtInIds) {
      expect(loreFieldsForAgentTypes([id])).toBeInstanceOf(Set);
    }
  });

  it("preserves full identity for unknown custom agent types", () => {
    const fields = loreFieldsForAgentTypes(["my-custom-agent"]);

    expect(fields).toEqual(
      new Set([
        "description",
        "personality",
        "backstory",
        "appearance",
        "scenario",
        "firstMes",
        "mesExample",
        "creatorNotes",
        "systemPrompt",
        "postHistoryInstructions",
        "personaStats",
        "rpgStats",
      ]),
    );
  });

  it("returns the union of every agent profile in a batch", () => {
    const fields = loreFieldsForAgentTypes(["music-dj", "expression", "persona-stats"]);

    expect(fields).toEqual(new Set(["description", "personality", "scenario", "appearance", "personaStats"]));
  });

  it("keeps music context compact", () => {
    const fields = loreFieldsForAgentTypes(["music-dj"]);

    expect(fields).toEqual(new Set(["description", "personality", "scenario"]));
    expect(fields).not.toContain("firstMes");
    expect(fields).not.toContain("mesExample");
    expect(fields).not.toContain("systemPrompt");
  });

  it("keeps every editable character-card field available to the card auditor", () => {
    const fields = loreFieldsForAgentTypes(["card-evolution-auditor"]);

    for (const editableField of EDITABLE_CHARACTER_CARD_FIELDS) {
      expect(fields).toContain(EDITABLE_FIELD_TO_LORE_FIELD[editableField]);
    }
  });

  it("serializes music and visual lore smaller than full identity lore", async () => {
    const [musicPrompt, visualPrompt, fullPrompt] = await Promise.all([
      captureSystemPrompt("music-dj"),
      captureSystemPrompt("background"),
      captureSystemPrompt("my-custom-agent"),
    ]);

    expect(musicPrompt.length).toBeLessThan(fullPrompt.length);
    expect(visualPrompt.length).toBeLessThan(fullPrompt.length);
    expect(musicPrompt).not.toContain(CARD_FIELD_VALUES.firstMes);
    expect(visualPrompt).not.toContain(CARD_FIELD_VALUES.personality);
  });

  it("serializes every exact editable source field for the card auditor", async () => {
    const prompt = await captureSystemPrompt("card-evolution-auditor");

    for (const value of Object.values(CARD_FIELD_VALUES)) {
      expect(prompt).toContain(value);
    }
  });

  it("restores full identity fields when a compact agent is batched with the card auditor", async () => {
    let batchMessages: ChatMessage[] = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        if (batchMessages.length === 0) batchMessages = messages;
        return {
          content: '<result agent="music-dj">{}</result><result agent="card-evolution-auditor">{"updates":[]}</result>',
        };
      },
    };

    await executeAgentBatch(
      [config("music-dj"), config("card-evolution-auditor")],
      richContext(),
      provider,
      "test-model",
    );
    const systemPrompt = batchMessages.find((message) => message.role === "system")?.content ?? "";

    for (const value of Object.values(CARD_FIELD_VALUES)) {
      expect(systemPrompt).toContain(value);
    }
  });
});

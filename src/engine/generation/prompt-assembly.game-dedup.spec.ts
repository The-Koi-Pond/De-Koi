import { describe, expect, it } from "vitest";

import type { CharacterData } from "../contracts/types/character";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import { BEHAVIORAL_INTERPRETATION_VERSION, behavioralInterpretationSourceHash } from "./behavioral-interpretation";
import { assembleGenerationPrompt, chatSummaryForGeneration } from "./prompt-assembly";

type JsonRecord = Record<string, unknown>;

it("keeps scene continuity in the exported summary fingerprint projection", () => {
  expect(
    chatSummaryForGeneration({
      mode: "roleplay",
      metadata: { lastRoleplaySceneSummary: "FINGERPRINT SCENE CONTINUITY SENTINEL" },
    }),
  ).toContain("FINGERPRINT SCENE CONTINUITY SENTINEL");
});

function asStorageValue<T>(value: unknown): T {
  return value as T;
}

function promptOwnershipStorage(options: {
  character?: JsonRecord;
  characters?: JsonRecord[];
  persona?: JsonRecord;
  lorebooks?: JsonRecord[];
  lorebookEntries?: JsonRecord[];
  promptBundle?: {
    preset: JsonRecord;
    sections: JsonRecord[];
  };
}): StorageGateway {
  const characters = options.characters ?? (options.character ? [options.character] : []);
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "prompts") {
        return asStorageValue<T[]>(options.promptBundle ? [options.promptBundle.preset] : []);
      }
      if (entity === "personas") return asStorageValue<T[]>(options.persona ? [options.persona] : []);
      if (entity === "lorebooks") return asStorageValue<T[]>(options.lorebooks ?? []);
      if (["regex-scripts", "agents", "lorebook-folders"].includes(entity)) return [];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "characters") {
        const character = characters.find((candidate) => candidate.id === id);
        if (character) return asStorageValue<T>(character);
      }
      if (entity === "personas" && options.persona?.id === id) return asStorageValue<T>(options.persona);
      if (entity === "prompts" && options.promptBundle?.preset.id === id) {
        return asStorageValue<T>(options.promptBundle.preset);
      }
      return null;
    },
    async create() {
      throw new Error("create should not be called");
    },
    async update() {
      throw new Error("update should not be called");
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages() {
      return [];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage() {
      throw new Error("createChatMessage should not be called");
    },
    async updateChatMessage() {
      throw new Error("updateChatMessage should not be called");
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return asStorageValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asStorageValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asStorageValue<T>({});
    },
    async listLorebookEntries() {
      return asStorageValue(options.lorebookEntries ?? []);
    },
    async listLorebookEntriesByLorebookIds<T = unknown>() {
      return asStorageValue<T[]>(options.lorebookEntries ?? []);
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull<T = unknown>() {
      if (!options.promptBundle) return null;
      return asStorageValue<T>({
        preset: options.promptBundle.preset,
        sections: options.promptBundle.sections,
        groups: [],
        choiceBlocks: [],
      });
    },
  };
}

function countOccurrences(text: string, sentinel: string): number {
  return text.split(sentinel).length - 1;
}

function promptText(result: Awaited<ReturnType<typeof assembleGenerationPrompt>>): string {
  return result.messages.map((message) => message.content).join("\n");
}

const ROLEPLAY_CHARACTER = {
  id: "mira",
  data: { name: "Mira", description: "ROLEPLAY CHARACTER" },
};

function roleplayStorage(sections: JsonRecord[]): StorageGateway {
  return promptOwnershipStorage({
    character: ROLEPLAY_CHARACTER,
    promptBundle: {
      preset: { id: "roleplay-preset", wrapFormat: "xml" },
      sections,
    },
  });
}

describe("prompt assembly ownership", () => {
  it("lets the canonical game prompt own card and lore facts without dropping preset content", async () => {
    const derivedBehavior = "DERIVED BEHAVIOR MUST STAY OUT OF GAME SENTINEL";
    const sentinels = {
      characterDescription: "CHARACTER DESCRIPTION SENTINEL",
      characterPersonality: "CHARACTER PERSONALITY SENTINEL",
      characterBackstory: "CHARACTER BACKSTORY SENTINEL",
      characterAppearance: "CHARACTER APPEARANCE SENTINEL",
      characterScenario: "CHARACTER SCENARIO SENTINEL",
      characterGreeting: "CHARACTER GREETING SENTINEL",
      characterExample: "CHARACTER EXAMPLE SENTINEL",
      characterSystem: "CHARACTER SYSTEM SENTINEL",
      characterPostHistory: "CHARACTER POST HISTORY SENTINEL",
      characterCreatorNotes: "CHARACTER CREATOR NOTES SENTINEL",
      characterPublicProfile: "CHARACTER PUBLIC PROFILE SENTINEL",
      characterMemory: "CHARACTER MEMORY SENTINEL",
      personaDescription: "PERSONA DESCRIPTION SENTINEL",
      personaPersonality: "PERSONA PERSONALITY SENTINEL",
      personaBackstory: "PERSONA BACKSTORY SENTINEL",
      personaAppearance: "PERSONA APPEARANCE SENTINEL",
      personaScenario: "PERSONA SCENARIO SENTINEL",
      beforeLore: "BEFORE LORE SENTINEL",
      afterLore: "AFTER LORE SENTINEL",
      beforeInstruction: "BEFORE INSTRUCTION SENTINEL",
      afterInstruction: "AFTER INSTRUCTION SENTINEL",
      depthInstruction: "DEPTH INSTRUCTION SENTINEL",
      summary: "GAME SUMMARY SENTINEL",
      history: "GAME HISTORY SENTINEL",
    } as const;
    const characterData = {
      name: "Mira",
      description: sentinels.characterDescription,
      personality: sentinels.characterPersonality,
      scenario: sentinels.characterScenario,
      creator_notes: sentinels.characterCreatorNotes,
      system_prompt: sentinels.characterSystem,
      mes_example: sentinels.characterExample,
      first_mes: sentinels.characterGreeting,
      post_history_instructions: sentinels.characterPostHistory,
      extensions: {
        backstory: sentinels.characterBackstory,
        appearance: sentinels.characterAppearance,
        publicProfile: { bio: sentinels.characterPublicProfile },
        characterMemories: [
          {
            createdAt: new Date().toISOString(),
            summary: sentinels.characterMemory,
          },
        ],
      },
    };
    const character = {
      id: "mira",
      data: characterData,
      behavioralInterpretation: {
        version: BEHAVIORAL_INTERPRETATION_VERSION,
        sourceHash: behavioralInterpretationSourceHash(characterData as unknown as CharacterData),
        status: "ready",
        enabled: true,
        claims: [
          {
            id: "behavior-1",
            statement: derivedBehavior,
            evidenceClass: "strongly_implied",
            evidence: [],
            source: "generated",
          },
        ],
      },
    };
    const persona = {
      id: "persona-1",
      data: {
        name: "Player",
        description: sentinels.personaDescription,
        personality: sentinels.personaPersonality,
        backstory: sentinels.personaBackstory,
        appearance: sentinels.personaAppearance,
        scenario: sentinels.personaScenario,
      },
    };
    const sections: JsonRecord[] = [
      {
        id: "before-instruction",
        enabled: true,
        sortOrder: 1,
        name: "Before Instruction",
        role: "system",
        content: sentinels.beforeInstruction,
      },
      {
        id: "character",
        enabled: true,
        sortOrder: 2,
        name: "Character",
        role: "system",
        markerConfig: { type: "character" },
      },
      {
        id: "creator-notes",
        enabled: true,
        sortOrder: 3,
        name: "Creator Notes",
        role: "system",
        markerConfig: { type: "character", characterFields: ["creator_notes"] },
      },
      {
        id: "character-aliases",
        enabled: true,
        sortOrder: 3.5,
        name: "Character Aliases",
        role: "system",
        markerConfig: {
          type: "character",
          characterFields: ["firstMes", "mesExample", "creatorNotes", "systemPrompt", "postHistoryInstructions"],
        },
      },
      {
        id: "dialogue-examples",
        enabled: true,
        sortOrder: 4,
        name: "Dialogue Examples",
        role: "system",
        markerConfig: { type: "dialogue_examples" },
      },
      {
        id: "persona",
        enabled: true,
        sortOrder: 5,
        name: "Persona",
        role: "system",
        markerConfig: { type: "persona" },
      },
      {
        id: "before-lore",
        enabled: true,
        sortOrder: 6,
        name: "Before Lore",
        role: "system",
        markerConfig: { type: "world_info_before" },
      },
      {
        id: "after-instruction",
        enabled: true,
        sortOrder: 7,
        name: "After Instruction",
        role: "system",
        content: sentinels.afterInstruction,
      },
      {
        id: "after-lore",
        enabled: true,
        sortOrder: 8,
        name: "After Lore",
        role: "system",
        markerConfig: { type: "world_info_after" },
      },
      {
        id: "summary",
        enabled: true,
        sortOrder: 9,
        name: "Summary",
        role: "system",
        markerConfig: { type: "chat_summary" },
      },
      {
        id: "depth",
        enabled: true,
        sortOrder: 10,
        name: "Depth Instruction",
        role: "system",
        content: sentinels.depthInstruction,
        injectionPosition: "depth",
        injectionDepth: 0,
      },
      {
        id: "history",
        enabled: true,
        sortOrder: 11,
        name: "History",
        role: "system",
        markerConfig: { type: "chat_history" },
      },
    ];
    const storage = promptOwnershipStorage({
      character,
      persona,
      lorebooks: [{ id: "book-1", name: "World", enabled: true, isGlobal: true, scanDepth: 0 }],
      lorebookEntries: [
        {
          id: "before-entry",
          lorebookId: "book-1",
          name: "Before",
          content: sentinels.beforeLore,
          enabled: true,
          constant: true,
          position: 0,
        },
        {
          id: "after-entry",
          lorebookId: "book-1",
          name: "After",
          content: sentinels.afterLore,
          enabled: true,
          constant: true,
          position: 1,
        },
      ],
      promptBundle: {
        preset: { id: "game-preset", wrapFormat: "xml" },
        sections,
      },
    });

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "game-chat",
        mode: "game",
        characterIds: ["mira"],
        personaId: "persona-1",
        promptPresetId: "game-preset",
        metadata: {
          enableMemoryRecall: false,
          conversationSummary: sentinels.summary,
          gamePartyCharacterIds: ["mira"],
        },
      },
      storedMessages: [{ id: "history-1", role: "user", content: sentinels.history }],
      connection: { provider: "openai", model: "game-model" },
      request: { promptPresetId: "game-preset" },
      latestUserInput: sentinels.history,
    });
    const text = promptText(result);

    for (const sentinel of Object.values(sentinels)) {
      expect.soft(countOccurrences(text, sentinel), sentinel).toBe(1);
    }
    expect(text).toContain("<before_instruction>");
    expect(text).toContain("<after_instruction>");
    expect(text.indexOf(sentinels.beforeInstruction)).toBeLessThan(text.indexOf(sentinels.afterInstruction));
    expect(text).not.toContain(derivedBehavior);
  });

  it("keeps the last roleplay scene summary once when a preset owns chat_summary", async () => {
    const sceneSummary = "ROLEPLAY PRESET SCENE SUMMARY SENTINEL";
    const result = await assembleGenerationPrompt(
      roleplayStorage([
        {
          id: "core",
          enabled: true,
          sortOrder: 1,
          name: "Core",
          role: "system",
          content: "ROLEPLAY CORE",
        },
        {
          id: "summary",
          enabled: true,
          sortOrder: 2,
          name: "Summary",
          role: "system",
          markerConfig: { type: "chat_summary" },
        },
        {
          id: "history",
          enabled: true,
          sortOrder: 3,
          name: "History",
          role: "system",
          markerConfig: { type: "chat_history" },
        },
      ]),
      {
        chat: {
          id: "roleplay-chat",
          mode: "roleplay",
          characterIds: ["mira"],
          promptPresetId: "roleplay-preset",
          metadata: { enableMemoryRecall: false, lastRoleplaySceneSummary: sceneSummary },
        },
        storedMessages: [{ id: "history-1", role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "roleplay-model" },
        request: { promptPresetId: "roleplay-preset" },
        latestUserInput: "Continue.",
      },
    );

    expect(countOccurrences(promptText(result), sceneSummary)).toBe(1);
  });

  it("keeps the last roleplay scene summary once on the fallback-summary path", async () => {
    const sceneSummary = "ROLEPLAY FALLBACK SCENE SUMMARY SENTINEL";
    const result = await assembleGenerationPrompt(
      roleplayStorage([
        {
          id: "core",
          enabled: true,
          sortOrder: 1,
          name: "Core",
          role: "system",
          content: "ROLEPLAY CORE",
        },
        {
          id: "history",
          enabled: true,
          sortOrder: 2,
          name: "History",
          role: "system",
          markerConfig: { type: "chat_history" },
        },
      ]),
      {
        chat: {
          id: "roleplay-chat",
          mode: "roleplay",
          characterIds: ["mira"],
          promptPresetId: "roleplay-preset",
          metadata: { enableMemoryRecall: false, lastRoleplaySceneSummary: sceneSummary },
        },
        storedMessages: [{ id: "history-1", role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "roleplay-model" },
        request: { promptPresetId: "roleplay-preset" },
        latestUserInput: "Continue.",
      },
    );

    expect(countOccurrences(promptText(result), sceneSummary)).toBe(1);
  });

  it("keeps projected summary and full authored facts in a game with no preset", async () => {
    const facts = {
      description: "NO PRESET DESCRIPTION SENTINEL",
      personality: "NO PRESET PERSONALITY SENTINEL",
      backstory: "NO PRESET BACKSTORY SENTINEL",
      appearance: "NO PRESET APPEARANCE SENTINEL",
      scenario: "NO PRESET SCENARIO SENTINEL",
      greeting: "NO PRESET GREETING SENTINEL",
      example: "NO PRESET EXAMPLE SENTINEL",
      creatorNotes: "NO PRESET CREATOR NOTES SENTINEL",
      system: "NO PRESET SYSTEM SENTINEL",
      postHistory: "NO PRESET POST HISTORY SENTINEL",
      publicProfile: "NO PRESET PUBLIC PROFILE SENTINEL",
      memory: "NO PRESET MEMORY SENTINEL",
      persona: "NO PRESET PERSONA SENTINEL",
      beforeLore: "NO PRESET BEFORE LORE SENTINEL",
      afterLore: "NO PRESET AFTER LORE SENTINEL",
      summary: "NO PRESET SUMMARY SENTINEL",
    } as const;
    const storage = promptOwnershipStorage({
      character: {
        id: "mira",
        data: {
          name: "Mira",
          description: facts.description,
          personality: facts.personality,
          scenario: facts.scenario,
          first_mes: facts.greeting,
          mes_example: facts.example,
          creator_notes: facts.creatorNotes,
          system_prompt: facts.system,
          post_history_instructions: facts.postHistory,
          extensions: {
            backstory: facts.backstory,
            appearance: facts.appearance,
            publicProfile: { bio: facts.publicProfile },
            characterMemories: [{ createdAt: new Date().toISOString(), summary: facts.memory }],
          },
        },
      },
      persona: { id: "persona-1", data: { name: "Player", description: facts.persona } },
      lorebooks: [{ id: "book-1", name: "World", enabled: true, isGlobal: true, scanDepth: 0 }],
      lorebookEntries: [
        {
          id: "before-entry",
          lorebookId: "book-1",
          name: "Before",
          content: facts.beforeLore,
          enabled: true,
          constant: true,
          position: 0,
        },
        {
          id: "after-entry",
          lorebookId: "book-1",
          name: "After",
          content: facts.afterLore,
          enabled: true,
          constant: true,
          position: 1,
        },
      ],
    });

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "game-no-preset",
        mode: "game",
        characterIds: ["mira"],
        personaId: "persona-1",
        metadata: {
          enableMemoryRecall: false,
          gamePartyCharacterIds: ["mira"],
          conversationSummary: facts.summary,
        },
      },
      storedMessages: [{ id: "history", role: "user", content: "Continue." }],
      connection: { provider: "openai", model: "game-model" },
      request: {},
      latestUserInput: "Continue.",
    });
    const text = promptText(result);

    for (const fact of Object.values(facts)) {
      expect.soft(countOccurrences(text, fact), fact).toBe(1);
    }
  });

  it("preserves a combined lore marker role and context while deduplicating game lore", async () => {
    const beforeLore = "COMBINED BEFORE LORE SENTINEL";
    const afterLore = "COMBINED AFTER LORE SENTINEL";
    const storage = promptOwnershipStorage({
      character: { id: "mira", data: { name: "Mira", description: "Guide" } },
      lorebooks: [{ id: "book-1", name: "World", enabled: true, isGlobal: true, scanDepth: 0 }],
      lorebookEntries: [
        {
          id: "before-entry",
          lorebookId: "book-1",
          name: "Before",
          content: beforeLore,
          enabled: true,
          constant: true,
          position: 0,
        },
        {
          id: "after-entry",
          lorebookId: "book-1",
          name: "After",
          content: afterLore,
          enabled: true,
          constant: true,
          position: 1,
        },
      ],
      promptBundle: {
        preset: { id: "combined-lore-preset", wrapFormat: "xml" },
        sections: [
          {
            id: "lore",
            enabled: true,
            sortOrder: 1,
            name: "Combined Lore",
            role: "assistant",
            markerConfig: { type: "lorebook" },
          },
          {
            id: "history",
            enabled: true,
            sortOrder: 2,
            name: "History",
            role: "system",
            markerConfig: { type: "chat_history" },
          },
        ],
      },
    });

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "combined-lore-game",
        mode: "game",
        characterIds: ["mira"],
        promptPresetId: "combined-lore-preset",
        metadata: { enableMemoryRecall: false, gamePartyCharacterIds: ["mira"] },
      },
      storedMessages: [{ id: "history", role: "user", content: "Continue." }],
      connection: { provider: "openai", model: "game-model" },
      request: { promptPresetId: "combined-lore-preset" },
      latestUserInput: "Continue.",
    });
    const text = promptText(result);
    const loreMessage = result.previewMessages.find((message) => message.content.includes(beforeLore));

    expect(countOccurrences(text, beforeLore)).toBe(1);
    expect(countOccurrences(text, afterLore)).toBe(1);
    expect(loreMessage).toMatchObject({ role: "assistant", contextKind: "lorebook" });
    expect(loreMessage?.content).toContain("<combined_lore>");
  });

  it("emits a shared group scenario once while preserving distinct character macro expansions", async () => {
    const characters = [
      {
        id: "mira",
        data: { name: "Mira", description: "Mira guide", scenario: "ORIGINAL MIRA SCENARIO SENTINEL" },
      },
      {
        id: "sol",
        data: { name: "Sol", description: "Sol guide", scenario: "ORIGINAL SOL SCENARIO SENTINEL" },
      },
    ];
    const assemble = async (options: { groupScenarioText: string; withCharacterMarker: boolean }) => {
      const promptBundle = options.withCharacterMarker
        ? {
            preset: { id: "group-scenario-preset", wrapFormat: "xml" },
            sections: [
              {
                id: "character",
                enabled: true,
                sortOrder: 1,
                name: "Character",
                role: "system",
                markerConfig: { type: "character", characterFields: ["description"] },
              },
              {
                id: "history",
                enabled: true,
                sortOrder: 2,
                name: "History",
                role: "system",
                markerConfig: { type: "chat_history" },
              },
            ],
          }
        : undefined;
      const storage = promptOwnershipStorage({ characters, promptBundle });
      return assembleGenerationPrompt(storage, {
        chat: {
          id: "group-scenario-game",
          mode: "game",
          characterIds: ["mira", "sol"],
          ...(promptBundle ? { promptPresetId: "group-scenario-preset" } : {}),
          metadata: {
            enableMemoryRecall: false,
            gamePartyCharacterIds: ["mira", "sol"],
            groupScenarioOverride: true,
            groupScenarioText: options.groupScenarioText,
          },
        },
        storedMessages: [{ id: "history", role: "user", content: "Continue." }],
        connection: { provider: "openai", model: "game-model" },
        request: promptBundle ? { promptPresetId: "group-scenario-preset" } : {},
        latestUserInput: "Continue.",
      });
    };

    const sharedScenario = "SHARED GROUP SCENARIO SENTINEL";
    const sharedText = promptText(await assemble({ groupScenarioText: sharedScenario, withCharacterMarker: false }));
    expect(countOccurrences(sharedText, sharedScenario)).toBe(1);
    expect(sharedText).not.toContain("ORIGINAL MIRA SCENARIO SENTINEL");
    expect(sharedText).not.toContain("ORIGINAL SOL SCENARIO SENTINEL");

    const distinctText = promptText(
      await assemble({ groupScenarioText: "DISTINCT GROUP SCENARIO FOR {{char}}", withCharacterMarker: true }),
    );
    expect(countOccurrences(distinctText, "DISTINCT GROUP SCENARIO FOR Mira")).toBe(1);
    expect(countOccurrences(distinctText, "DISTINCT GROUP SCENARIO FOR Sol")).toBe(1);
    expect(distinctText).not.toContain("DISTINCT GROUP SCENARIO FOR Mira, Sol");
    expect(distinctText).not.toContain("ORIGINAL MIRA SCENARIO SENTINEL");
    expect(distinctText).not.toContain("ORIGINAL SOL SCENARIO SENTINEL");
  });

  it("resolves character-specific and preset macros in canonical game cards", async () => {
    const storage = promptOwnershipStorage({
      characters: [
        {
          id: "mira",
          data: { name: "Mira", description: "MIRA CARD {{char}} / {{user}} / {{mood}}" },
        },
        {
          id: "sol",
          data: { name: "Sol", description: "SOL CARD {{char}} / {{user}} / {{mood}}" },
        },
      ],
      persona: { id: "persona-1", data: { name: "Player" } },
      promptBundle: {
        preset: { id: "macro-preset", wrapFormat: "xml", variableValues: { mood: "STEADY" } },
        sections: [
          {
            id: "instruction",
            enabled: true,
            sortOrder: 1,
            name: "Instruction",
            role: "system",
            content: "KEEP MACRO PRESET INSTRUCTION",
          },
          {
            id: "history",
            enabled: true,
            sortOrder: 2,
            name: "History",
            role: "system",
            markerConfig: { type: "chat_history" },
          },
        ],
      },
    });

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "macro-game",
        mode: "game",
        characterIds: ["mira", "sol"],
        personaId: "persona-1",
        promptPresetId: "macro-preset",
        metadata: { enableMemoryRecall: false, gamePartyCharacterIds: ["mira", "sol"] },
      },
      storedMessages: [{ id: "history", role: "user", content: "Continue." }],
      connection: { provider: "openai", model: "game-model" },
      request: { promptPresetId: "macro-preset" },
      latestUserInput: "Continue.",
    });
    const text = promptText(result);

    expect(text).toContain("MIRA CARD Mira / Player / STEADY");
    expect(text).toContain("SOL CARD Sol / Player / STEADY");
    expect(text).not.toContain("{{char}}");
    expect(text).not.toContain("{{user}}");
    expect(text).not.toContain("{{mood}}");
  });

  it("preserves owned marker depth roles, order, and context kinds", async () => {
    const characterFact = "DEPTH CHARACTER SENTINEL";
    const personaFact = "DEPTH PERSONA SENTINEL";
    const loreFact = "DEPTH LORE SENTINEL";
    const arbitraryDepth = "ARBITRARY DEPTH SENTINEL";
    const storage = promptOwnershipStorage({
      character: { id: "mira", data: { name: "Mira", description: characterFact } },
      persona: { id: "persona-1", data: { name: "Player", description: personaFact } },
      lorebooks: [{ id: "book-1", name: "World", enabled: true, isGlobal: true, scanDepth: 0 }],
      lorebookEntries: [
        {
          id: "lore-entry",
          lorebookId: "book-1",
          name: "Lore",
          content: loreFact,
          enabled: true,
          constant: true,
          position: 0,
        },
      ],
      promptBundle: {
        preset: { id: "depth-owner-preset", wrapFormat: "xml" },
        sections: [
          {
            id: "core",
            enabled: true,
            sortOrder: 1,
            name: "Core",
            role: "system",
            content: "DEPTH OWNER CORE",
          },
          {
            id: "character-depth",
            enabled: true,
            sortOrder: 2,
            name: "Character Depth",
            role: "assistant",
            markerConfig: { type: "character" },
            injectionPosition: "depth",
            injectionDepth: 0,
            injectionOrder: 10,
          },
          {
            id: "persona-depth",
            enabled: true,
            sortOrder: 3,
            name: "Persona Depth",
            role: "user",
            markerConfig: { type: "persona" },
            injectionPosition: "depth",
            injectionDepth: 0,
            injectionOrder: 20,
          },
          {
            id: "lore-depth",
            enabled: true,
            sortOrder: 4,
            name: "Lore Depth",
            role: "system",
            markerConfig: { type: "lorebook" },
            injectionPosition: "depth",
            injectionDepth: 0,
            injectionOrder: 30,
          },
          {
            id: "arbitrary-depth",
            enabled: true,
            sortOrder: 5,
            name: "Arbitrary Depth",
            role: "assistant",
            content: arbitraryDepth,
            injectionPosition: "depth",
            injectionDepth: 0,
            injectionOrder: 40,
          },
          {
            id: "history",
            enabled: true,
            sortOrder: 6,
            name: "History",
            role: "system",
            markerConfig: { type: "chat_history" },
          },
        ],
      },
    });

    const result = await assembleGenerationPrompt(storage, {
      chat: {
        id: "depth-owner-game",
        mode: "game",
        characterIds: ["mira"],
        personaId: "persona-1",
        promptPresetId: "depth-owner-preset",
        metadata: { enableMemoryRecall: false, gamePartyCharacterIds: ["mira"] },
      },
      storedMessages: [{ id: "history", role: "user", content: "Continue." }],
      connection: { provider: "openai", model: "game-model" },
      request: { promptPresetId: "depth-owner-preset" },
      latestUserInput: "Continue.",
    });
    const messages = result.previewMessages;
    const characterIndex = messages.findIndex((message) => message.content.includes(characterFact));
    const personaIndex = messages.findIndex((message) => message.content.includes(personaFact));
    const loreIndex = messages.findIndex((message) => message.content.includes(loreFact));
    const arbitraryIndex = messages.findIndex((message) => message.content.includes(arbitraryDepth));

    expect(messages[characterIndex]).toMatchObject({ role: "assistant", contextKind: "directive" });
    expect(messages[personaIndex]).toMatchObject({ role: "user", contextKind: "directive" });
    expect(messages[loreIndex]).toMatchObject({ role: "system", contextKind: "lorebook" });
    expect(messages[arbitraryIndex]).toMatchObject({ role: "assistant", contextKind: "directive" });
    expect([characterIndex, personaIndex, loreIndex, arbitraryIndex]).toEqual(
      [...[characterIndex, personaIndex, loreIndex, arbitraryIndex]].sort((left, right) => left - right),
    );
    expect(countOccurrences(promptText(result), characterFact)).toBe(1);
    expect(countOccurrences(promptText(result), personaFact)).toBe(1);
    expect(countOccurrences(promptText(result), loreFact)).toBe(1);
  });
});

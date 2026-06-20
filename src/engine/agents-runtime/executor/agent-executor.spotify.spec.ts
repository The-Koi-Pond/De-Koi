import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../contracts/types/agent";
import type { BaseLLMProvider, ChatMessage, LLMToolCall } from "../../generation-core/llm/base-provider";
import { executeAgent, executeAgentBatch, type AgentExecConfig, type AgentToolContext } from "./agent-executor";

const FRESH_URI = "spotify:track:ABCDEFGHIJKLMNOPQRSTUV";

function spotifyContext(): AgentContext {
  return {
    chatId: "chat-1",
    chatMode: "roleplay",
    recentMessages: [],
    mainResponse: null,
    gameState: null,
    characters: [],
    persona: null,
    memory: {},
    activatedLorebookEntries: null,
    writableLorebookIds: null,
    chatSummary: null,
    streaming: false,
  };
}

describe("Spotify agent fallback playback", () => {
  it("repairs suffixed track URIs before fallback spotify_play", async () => {
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        return {
          content: JSON.stringify({
            action: "play",
            mood: "tense",
            searchQuery: "tense battle",
            trackUris: [`${FRESH_URI}_candidate`],
            trackNames: ["Fresh - Battle"],
            volume: null,
          }),
        };
      },
    };
    const calls: LLMToolCall[] = [];
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_play" }],
      async executeToolCall(call) {
        calls.push(call);
        return JSON.stringify({ success: true, applied: true, queued: [FRESH_URI] });
      },
    };
    const config: AgentExecConfig = {
      id: "spotify-agent",
      type: "spotify",
      name: "Spotify",
      phase: "post",
      promptTemplate: "Pick fitting music.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(config, spotifyContext(), provider, "test-model", toolContext);

    expect(result.success).toBe(true);
    expect(JSON.parse(calls[0]?.function.arguments ?? "{}")).toEqual({ uri: FRESH_URI });
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      toolFallbackApplied: true,
    });
  });

  it("does not treat pending spotify_play results as completed playback", async () => {
    let providerCalls = 0;
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        providerCalls += 1;
        if (providerCalls === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "call-play",
                name: "spotify_play",
                arguments: JSON.stringify({ uri: FRESH_URI }),
                function: {
                  name: "spotify_play",
                  arguments: JSON.stringify({ uri: FRESH_URI }),
                },
              },
            ],
          };
        }
        return {
          content: JSON.stringify({
            action: "play",
            mood: "tense",
            searchQuery: "tense battle",
            trackUris: [FRESH_URI],
            trackNames: ["Fresh - Battle"],
            volume: null,
          }),
        };
      },
    };
    const calls: LLMToolCall[] = [];
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_play" }],
      async executeToolCall(call) {
        calls.push(call);
        if (calls.length === 1) {
          return JSON.stringify({ success: true, applied: true, playbackPending: true, uris: [FRESH_URI] });
        }
        return JSON.stringify({ success: true, applied: true, queued: [FRESH_URI] });
      },
    };
    const config: AgentExecConfig = {
      id: "spotify-agent",
      type: "spotify",
      name: "Spotify",
      phase: "post",
      promptTemplate: "Pick fitting music.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(config, spotifyContext(), provider, "test-model", toolContext);

    expect(result.success).toBe(true);
    expect(calls.map((call) => call.function.name)).toEqual(["spotify_play", "spotify_play"]);
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      toolFallbackApplied: true,
    });
  });
});

describe("agent prompt quest context", () => {
  it("compacts completed quest progress for quest agents", async () => {
    let capturedMessages: ChatMessage[] = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        capturedMessages = messages;
        return {
          content: JSON.stringify({ updates: [] }),
        };
      },
    };
    const config: AgentExecConfig = {
      id: "quest-agent",
      type: "quest",
      name: "Quest",
      phase: "post",
      promptTemplate: "Update quests.",
      connectionId: null,
      settings: {},
    };
    const gameState = {
      playerStats: {
        activeQuests: [
          {
            questEntryId: "river-shrine",
            name: "Restore the River Shrine",
            currentStage: 1,
            objectives: [
              { objectiveId: "done", text: "Find the sluice key", completed: true },
              { objectiveId: "open", text: "Repair the sluice gate", completed: false },
            ],
            completed: false,
          },
          {
            questEntryId: "completed",
            name: "Completed Quest",
            currentStage: 1,
            objectives: [],
            completed: true,
          },
        ],
      },
    } as AgentContext["gameState"];
    const context: AgentContext = {
      chatId: "chat-1",
      chatMode: "game",
      recentMessages: [{ role: "assistant", content: "The party studies the shrine.", gameState }],
      mainResponse: "The gate groans open.",
      gameState,
      characters: [],
      persona: null,
      memory: {},
      activatedLorebookEntries: null,
      writableLorebookIds: null,
      chatSummary: null,
      streaming: false,
    };

    const result = await executeAgent(config, context, provider, "test-model");
    const promptText = capturedMessages.map((message) => message.content).join("\n");

    expect(result.success).toBe(true);
    expect(promptText).toContain("Repair the sluice gate");
    expect(promptText).not.toContain("Find the sluice key");
    expect(promptText).not.toContain("Completed Quest");
  });

  it("does not compact quest progress for non-quest agents in mixed execution", async () => {
    const capturedPrompts = new Map<string, string>();
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        const promptText = messages.map((message) => message.content).join("\n");
        if (promptText.includes("Update quests.")) {
          capturedPrompts.set("quest", promptText);
          return { content: JSON.stringify({ updates: [] }) };
        }
        capturedPrompts.set("world-state", promptText);
        return { content: JSON.stringify({ updates: [] }) };
      },
    };
    const configs: AgentExecConfig[] = [
      {
        id: "quest-agent",
        type: "quest",
        name: "Quest",
        phase: "post",
        promptTemplate: "Update quests.",
        connectionId: null,
        settings: {},
      },
      {
        id: "world-state-agent",
        type: "world-state",
        name: "World State",
        phase: "post",
        promptTemplate: "Update world state.",
        connectionId: null,
        settings: {},
      },
    ];
    const gameState = {
      playerStats: {
        activeQuests: [
          {
            questEntryId: "river-shrine",
            name: "Restore the River Shrine",
            currentStage: 1,
            objectives: [
              { objectiveId: "done", text: "Find the sluice key", completed: true },
              { objectiveId: "open", text: "Repair the sluice gate", completed: false },
            ],
            completed: false,
          },
          {
            questEntryId: "completed",
            name: "Completed Quest",
            currentStage: 1,
            objectives: [],
            completed: true,
          },
        ],
      },
    } as AgentContext["gameState"];
    const context: AgentContext = {
      chatId: "chat-1",
      chatMode: "game",
      recentMessages: [{ role: "assistant", content: "The party studies the shrine.", gameState }],
      mainResponse: "The gate groans open.",
      gameState,
      characters: [],
      persona: null,
      memory: {},
      activatedLorebookEntries: null,
      writableLorebookIds: null,
      chatSummary: null,
      streaming: false,
    };

    const results = await executeAgentBatch(configs, context, provider, "test-model");

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.success)).toBe(true);
    expect(capturedPrompts.get("quest")).toContain("Repair the sluice gate");
    expect(capturedPrompts.get("quest")).not.toContain("Find the sluice key");
    expect(capturedPrompts.get("quest")).not.toContain("Completed Quest");
    expect(capturedPrompts.get("world-state")).toContain("Repair the sluice gate");
    expect(capturedPrompts.get("world-state")).toContain("Find the sluice key");
    expect(capturedPrompts.get("world-state")).toContain("Completed Quest");
  });
});

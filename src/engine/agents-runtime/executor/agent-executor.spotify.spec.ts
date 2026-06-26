import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../contracts/types/agent";
import type {
  BaseLLMProvider,
  ChatCompleteOptions,
  ChatMessage,
  LLMToolCall,
} from "../../generation-core/llm/base-provider";
import {
  executeAgent,
  executeAgentBatch,
  shouldRunAgentIndividually,
  type AgentExecConfig,
  type AgentToolContext,
} from "./agent-executor";

const FRESH_URI = "spotify:track:ABCDEFGHIJKLMNOPQRSTUV";
const SECOND_URI = "spotify:track:ZYXWVUTSRQPONMLKJIHGFE";
const HALLUCINATED_URI = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";

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

describe("agent JSON retry", () => {
  const hasAssistantContent = (messages: ChatMessage[], content: string) =>
    messages.some((message) => message.role === "assistant" && message.content === content);

  it("retries malformed JSON agents once with a strict JSON reminder", async () => {
    const calls: ChatMessage[][] = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        calls.push(messages);
        if (calls.length === 1) {
          return { content: "{ not json", usage: { totalTokens: 3 } };
        }
        return {
          content: JSON.stringify({ expressions: [{ characterId: "char-1", expression: "happy" }] }),
          usage: { totalTokens: 5 },
        };
      },
    };
    const config: AgentExecConfig = {
      id: "expression-agent",
      type: "expression",
      name: "Expression",
      phase: "post",
      promptTemplate: "Return sprite expression JSON.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(config, spotifyContext(), provider, "test-model");

    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(8);
    expect(result.data).toEqual({ expressions: [{ characterId: "char-1", expression: "happy" }] });
    expect(calls).toHaveLength(2);
    const retryMessages = calls[1]!;
    expect(hasAssistantContent(retryMessages, "{ not json")).toBe(false);
    expect(retryMessages[retryMessages.length - 1]?.content).toContain("Return ONLY one valid JSON object");
  });

  it("does not retry malformed JSON when the agent signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        calls += 1;
        return { content: "{ not json", usage: { totalTokens: 3 } };
      },
    };
    const config: AgentExecConfig = {
      id: "expression-agent",
      type: "expression",
      name: "Expression",
      phase: "post",
      promptTemplate: "Return sprite expression JSON.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(
      config,
      { ...spotifyContext(), signal: controller.signal },
      provider,
      "test-model",
    );

    expect(calls).toBe(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain("malformed JSON");
  });

  it("retries malformed JSON after a tool loop returns a final response", async () => {
    const calls: Array<{ messages: ChatMessage[]; options: ChatCompleteOptions }> = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages, options) {
        calls.push({ messages, options });
        if (calls.length === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "call-lookup",
                name: "lookup",
                arguments: "{}",
                function: { name: "lookup", arguments: "{}" },
              },
            ],
            usage: { totalTokens: 2 },
          };
        }
        if (calls.length === 2) {
          return { content: "{ broken", usage: { totalTokens: 3 } };
        }
        return {
          content: JSON.stringify({ issues: [] }),
          usage: { totalTokens: 5 },
        };
      },
    };
    const toolContext: AgentToolContext = {
      tools: [{ name: "lookup" }],
      async executeToolCall() {
        return JSON.stringify({ ok: true });
      },
    };
    const config: AgentExecConfig = {
      id: "continuity-agent",
      type: "continuity",
      name: "Continuity",
      phase: "post",
      promptTemplate: "Use tools if needed, then return continuity JSON.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(config, spotifyContext(), provider, "test-model", toolContext);

    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(10);
    expect(result.data).toEqual({ issues: [] });
    expect(calls).toHaveLength(3);
    expect(calls[1]?.options.tools).toEqual([{ name: "lookup" }]);
    expect(calls[2]?.options.tools).toBeUndefined();
    const retryMessages = calls[2]!.messages;
    expect(hasAssistantContent(retryMessages, "{ broken")).toBe(false);
    expect(retryMessages[retryMessages.length - 1]?.content).toContain("Return ONLY one valid JSON object");
  });

  it("retries malformed JSON after exhausted tool rounds make a final no-tools call", async () => {
    const calls: Array<{ messages: ChatMessage[]; options: ChatCompleteOptions }> = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages, options) {
        calls.push({ messages, options });
        if (calls.length <= 5) {
          return {
            content: "",
            toolCalls: [
              {
                id: `call-${calls.length}`,
                name: "lookup",
                arguments: "{}",
                function: { name: "lookup", arguments: "{}" },
              },
            ],
            usage: { totalTokens: 1 },
          };
        }
        if (calls.length === 6) {
          return { content: "{ still broken", usage: { totalTokens: 2 } };
        }
        return {
          content: JSON.stringify({ updates: [] }),
          usage: { totalTokens: 3 },
        };
      },
    };
    const toolContext: AgentToolContext = {
      tools: [{ name: "lookup" }],
      async executeToolCall() {
        return JSON.stringify({ ok: true });
      },
    };
    const config: AgentExecConfig = {
      id: "lorebook-agent",
      type: "lorebook-keeper",
      name: "Lorebook Keeper",
      phase: "post",
      promptTemplate: "Use tools if needed, then return lorebook JSON.",
      connectionId: null,
      settings: {},
    };

    const result = await executeAgent(config, spotifyContext(), provider, "test-model", toolContext);

    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(10);
    expect(result.data).toEqual({ updates: [] });
    expect(calls).toHaveLength(7);
    expect(calls.slice(0, 5).every((call) => call.options.tools)).toBe(true);
    expect(calls[5]?.options.tools).toBeUndefined();
    expect(calls[6]?.options.tools).toBeUndefined();
    const retryMessages = calls[6]!.messages;
    expect(hasAssistantContent(retryMessages, "{ still broken")).toBe(false);
    expect(retryMessages[retryMessages.length - 1]?.content).toContain("Return ONLY one valid JSON object");
  });
});

describe("manual Illustrator requests", () => {
  it("tells paintbrush retries to bypass the autonomous key-moment gate", async () => {
    const calls: ChatMessage[][] = [];
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(messages) {
        calls.push(messages);
        return {
          content: JSON.stringify({ shouldGenerate: false, reason: "not visually significant" }),
          usage: { totalTokens: 3 },
        };
      },
    };
    const config: AgentExecConfig = {
      id: "illustrator-agent",
      type: "illustrator",
      name: "Illustrator",
      phase: "post",
      promptTemplate: "",
      connectionId: null,
      settings: {},
    };

    await executeAgent(
      config,
      {
        ...spotifyContext(),
        chatMode: "conversation",
        recentMessages: [{ role: "assistant", content: "Jello shots spill under neon bar lights." }],
        mainResponse: "Jello shots spill under neon bar lights.",
        memory: { _illustratorManualRequest: true },
      },
      provider,
      "test-model",
    );

    const systemPrompt = calls[0]?.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("<manual_illustration_request>");
    expect(systemPrompt).toContain("Manual paintbrush requests override the normal key narrative moment gate");
    expect(systemPrompt).toContain("Do not return shouldGenerate false merely because");
    expect(systemPrompt).toContain("Return shouldGenerate false only when");
  });
});

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

  it("treats pending spotify_play results as accepted playback", async () => {
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
        return JSON.stringify({
          success: true,
          applied: true,
          playbackPending: true,
          uris: [FRESH_URI],
          display: "Spotify accepted playback; verification pending",
        });
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
    expect(calls.map((call) => call.function.name)).toEqual(["spotify_play"]);
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      toolPlaybackApplied: true,
      playbackPending: true,
      display: "Spotify accepted playback; verification pending",
    });
  });

  it("keeps fallback available when pending spotify_play has no track evidence", async () => {
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
                arguments: JSON.stringify({ uri: "not-spotify" }),
                function: {
                  name: "spotify_play",
                  arguments: JSON.stringify({ uri: "not-spotify" }),
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
          return JSON.stringify({
            success: true,
            applied: true,
            playbackPending: true,
            display: "Spotify accepted playback; verification pending",
          });
        }
        return JSON.stringify({
          success: true,
          applied: true,
          queued: [FRESH_URI],
        });
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
    expect(JSON.parse(calls[1]?.function.arguments ?? "{}")).toEqual({ uri: FRESH_URI });
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      toolFallbackApplied: true,
    });
  });

  it("preserves partial queue status from pending fallback playback", async () => {
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete() {
        return {
          content: JSON.stringify({
            action: "play",
            mood: "tense",
            searchQuery: "tense battle",
            trackUris: [FRESH_URI, SECOND_URI],
            trackNames: ["Fresh - Battle", "Second - Battle"],
            volume: null,
          }),
        };
      },
    };
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_play" }],
      async executeToolCall() {
        return JSON.stringify({
          success: true,
          applied: true,
          playbackPending: true,
          queued: [FRESH_URI],
          queueStatus: "partial",
          partialQueueFailure: true,
        });
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
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      queued: 1,
      playbackPending: true,
      queueStatus: "partial",
      partialQueueFailure: true,
      toolFallbackApplied: true,
    });
  });

  it("applies playback fallback after batched spotify intent parsing", async () => {
    let sawModelTools = false;
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(_messages, options) {
        sawModelTools = sawModelTools || Boolean(options.tools);
        return {
          content: [
            `<result agent="spotify">`,
            JSON.stringify({
              action: "play",
              mood: "tense",
              searchQuery: "tense battle",
              trackUris: [],
              trackNames: [],
              volume: null,
            }),
            `</result>`,
            `<result agent="world-state">{"updates":[]}</result>`,
          ].join("\n"),
        };
      },
    };
    const calls: LLMToolCall[] = [];
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_get_playlist_tracks" }, { name: "spotify_play" }],
      async executeToolCall(call) {
        calls.push(call);
        if (call.function.name === "spotify_get_playlist_tracks") {
          return JSON.stringify({
            tracks: [
              { uri: FRESH_URI, name: "Fresh", artist: "Battle" },
              { uri: SECOND_URI, name: "Second", artist: "Battle" },
            ],
          });
        }
        return JSON.stringify({
          success: true,
          applied: true,
          queued: [FRESH_URI, SECOND_URI],
        });
      },
    };
    const configs: AgentExecConfig[] = [
      {
        id: "spotify-agent",
        type: "spotify",
        name: "Spotify",
        phase: "post_processing",
        promptTemplate: "Pick fitting music.",
        connectionId: null,
        settings: {},
        toolContext,
      },
      {
        id: "world-state-agent",
        type: "world-state",
        name: "World State",
        phase: "post_processing",
        promptTemplate: "Update state.",
        connectionId: null,
        settings: {},
      },
    ];

    const results = await executeAgentBatch(
      configs,
      {
        ...spotifyContext(),
        memory: { _spotifyDjConstraints: { sourceType: "liked", playlistId: "liked", mode: "roleplay" } },
      },
      provider,
      "test-model",
    );

    const spotifyResult = results.find((result) => result.agentType === "spotify");
    expect(sawModelTools).toBe(false);
    expect(calls.map((call) => call.function.name)).toEqual(["spotify_get_playlist_tracks", "spotify_play"]);
    expect(JSON.parse(calls[1]?.function.arguments ?? "{}")).toEqual({ uris: [FRESH_URI, SECOND_URI] });
    expect(spotifyResult?.success).toBe(true);
    expect(spotifyResult?.data).toMatchObject({
      trackUris: [FRESH_URI, SECOND_URI],
      trackNames: ["Fresh - Battle", "Second - Battle"],
      toolFallbackApplied: true,
    });
  });

  it("applies volume fallback after batched spotify intent parsing", async () => {
    let sawModelTools = false;
    const provider: BaseLLMProvider = {
      maxTokensOverrideValue: null,
      async chatComplete(_messages, options) {
        sawModelTools = sawModelTools || Boolean(options.tools);
        return {
          content: [
            `<result agent="spotify">`,
            JSON.stringify({
              action: "volume",
              mood: "quiet conversation",
              searchQuery: "",
              trackUris: [],
              trackNames: [],
              volume: 30,
            }),
            `</result>`,
            `<result agent="world-state">{"updates":[]}</result>`,
          ].join("\n"),
        };
      },
    };
    const calls: LLMToolCall[] = [];
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_set_volume" }],
      async executeToolCall(call) {
        calls.push(call);
        return JSON.stringify({ success: true, volume: 30 });
      },
    };
    const configs: AgentExecConfig[] = [
      {
        id: "spotify-agent",
        type: "spotify",
        name: "Spotify",
        phase: "post_processing",
        promptTemplate: "Adjust fitting volume.",
        connectionId: null,
        settings: {},
        toolContext,
      },
      {
        id: "world-state-agent",
        type: "world-state",
        name: "World State",
        phase: "post_processing",
        promptTemplate: "Update state.",
        connectionId: null,
        settings: {},
      },
    ];

    const results = await executeAgentBatch(configs, spotifyContext(), provider, "test-model");

    const spotifyResult = results.find((result) => result.agentType === "spotify");
    expect(sawModelTools).toBe(false);
    expect(calls.map((call) => call.function.name)).toEqual(["spotify_set_volume"]);
    expect(JSON.parse(calls[0]?.function.arguments ?? "{}")).toEqual({ volume: 30 });
    expect(spotifyResult?.success).toBe(true);
    expect(spotifyResult?.data).toMatchObject({
      action: "volume",
      volume: 30,
      toolFallbackApplied: true,
    });
  });

  it("retrieves fresh candidates when selected spotify URIs are outside the known shortlist", async () => {
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
                id: "call-candidates",
                name: "spotify_get_playlist_tracks",
                arguments: JSON.stringify({ playlistId: "liked", query: "tense battle" }),
                function: {
                  name: "spotify_get_playlist_tracks",
                  arguments: JSON.stringify({ playlistId: "liked", query: "tense battle" }),
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
            trackUris: [HALLUCINATED_URI],
            trackNames: ["Made Up - Track"],
            volume: null,
          }),
        };
      },
    };
    const calls: LLMToolCall[] = [];
    const toolContext: AgentToolContext = {
      tools: [{ name: "spotify_get_playlist_tracks" }, { name: "spotify_play" }],
      async executeToolCall(call) {
        calls.push(call);
        if (call.function.name === "spotify_get_playlist_tracks") {
          return JSON.stringify({ tracks: [{ uri: FRESH_URI, name: "Fresh", artist: "Battle" }] });
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

    const result = await executeAgent(
      config,
      {
        ...spotifyContext(),
        memory: { _spotifyDjConstraints: { sourceType: "liked", playlistId: "liked", mode: "roleplay" } },
      },
      provider,
      "test-model",
      toolContext,
    );

    expect(result.success).toBe(true);
    expect(calls.map((call) => call.function.name)).toEqual([
      "spotify_get_playlist_tracks",
      "spotify_get_playlist_tracks",
      "spotify_play",
    ]);
    expect(JSON.parse(calls[2]?.function.arguments ?? "{}")).toEqual({ uri: FRESH_URI });
    expect(result.data).toMatchObject({
      trackUris: [FRESH_URI],
      trackNames: ["Fresh - Battle"],
      toolFallbackApplied: true,
    });
  });
});

describe("agent prompt quest context", () => {
  it("keeps quest agents out of shared batch prompts", () => {
    expect(shouldRunAgentIndividually({ type: "quest" })).toBe(true);
    expect(shouldRunAgentIndividually({ type: "world-state" })).toBe(false);
  });

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

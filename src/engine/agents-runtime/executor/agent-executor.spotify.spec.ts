import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../contracts/types/agent";
import type { BaseLLMProvider, LLMToolCall } from "../../generation-core/llm/base-provider";
import { executeAgent, type AgentExecConfig, type AgentToolContext } from "./agent-executor";

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

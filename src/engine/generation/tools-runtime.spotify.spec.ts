import { describe, expect, it } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { LLMToolCall } from "../generation-core/llm/base-provider";
import { executeBuiltInTool, type ToolRuntimeInput } from "./tools-runtime";

const RECENT_URI = "spotify:track:1234567890123456789012";
const FRESH_URI = "spotify:track:ABCDEFGHIJKLMNOPQRSTUV";
const OLD_URI = "spotify:track:ZZZZZZZZZZZZZZZZZZZZZZ";
const FULL_RECENT_HISTORY = Array.from(
  { length: 24 },
  (_, index) => `spotify:track:${index.toString(36).padStart(22, "0")}`,
);

function asValue<T>(value: unknown): T {
  return value as T;
}

function toolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: `tool-${name}`,
    name,
    arguments: JSON.stringify(args),
    function: { name, arguments: JSON.stringify(args) },
  };
}

function runtimeInput(chat: Record<string, unknown>): ToolRuntimeInput {
  return {
    chat,
    activatedLorebookEntries: [],
    characters: [],
    persona: null,
    chatSummary: null,
  };
}

function storageFor(chat: Record<string, unknown>): StorageGateway {
  return {
    async list() {
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return asValue<T>(chat);
      return null;
    },
    async create() {
      throw new Error("create should not be called");
    },
    async update<T = unknown>(entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      if (entity === "chats" && id === chat.id) {
        Object.assign(chat, patch);
        return asValue<T>(chat);
      }
      throw new Error("unexpected update");
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
      return asValue<T>({});
    },
    async addChatMessageSwipe<T = unknown>() {
      return asValue<T>({});
    },
    async patchChatMetadata<T = unknown>() {
      return asValue<T>({});
    },
    async patchChatSummaries<T = unknown>() {
      return asValue<T>({});
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState() {
      return null;
    },
    async saveTrackerSnapshot<T = unknown>() {
      return asValue<T>({});
    },
    async listLorebookEntries() {
      return [];
    },
    async listLorebookEntriesByLorebookIds() {
      return [];
    },
    async createLorebookEntries() {
      return [];
    },
    async promptFull() {
      return null;
    },
  } as StorageGateway;
}

function spotifyIntegrations(overrides: Partial<IntegrationGateway["spotify"]>): IntegrationGateway {
  const spotify: IntegrationGateway["spotify"] = {
    async player<T = unknown>() {
      return asValue<T>({});
    },
    async playlists<T = unknown>() {
      return asValue<T>({});
    },
    async playlistTracks<T = unknown>() {
      return asValue<T>({});
    },
    async searchTracks<T = unknown>() {
      return asValue<T>({});
    },
    async playTrack<T = unknown>() {
      return asValue<T>({});
    },
    async play<T = unknown>() {
      return asValue<T>({});
    },
    async volume<T = unknown>() {
      return asValue<T>({});
    },
    ...overrides,
  };
  return {
    spotify,
    customTools: {
      async execute<T = unknown>() {
        return asValue<T>({});
      },
    },
    image: {
      async generate<T = unknown>() {
        return asValue<T>({});
      },
    },
  };
}

describe("Spotify tool runtime", () => {
  it("passes full recent chat history to Spotify candidate lookups", async () => {
    const chat = { id: "chat-1", mode: "roleplay", metadata: { spotifyRecentTracks: FULL_RECENT_HISTORY } };
    let playlistCaptured: Record<string, unknown> | null = null;
    let searchCaptured: Record<string, unknown> | null = null;
    const integrations = spotifyIntegrations({
      async playlistTracks<T = unknown>(input: Record<string, unknown>) {
        playlistCaptured = input;
        return asValue<T>({ tracks: [] });
      },
      async searchTracks<T = unknown>(input: Record<string, unknown>) {
        searchCaptured = input;
        return asValue<T>({ tracks: [] });
      },
    });

    await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_get_playlist_tracks", { playlistId: "liked", query: "tense", candidateLimit: 40 }),
    );
    await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_search", { query: "tense", limit: 10 }),
    );

    expect(playlistCaptured).toMatchObject({
      playlistId: "liked",
      recentTrackUris: FULL_RECENT_HISTORY,
    });
    expect(searchCaptured).toMatchObject({
      query: "tense",
      recentTrackUris: FULL_RECENT_HISTORY,
    });
  });

  it("repairs suffixed Spotify track URIs and remembers played tracks", async () => {
    const chat = { id: "chat-1", mode: "roleplay", metadata: { spotifyRecentTracks: [OLD_URI] } };
    let captured: Record<string, unknown> | null = null;
    const integrations = spotifyIntegrations({
      async play<T = unknown>(body: Record<string, unknown>) {
        captured = body;
        return asValue<T>({ success: true, applied: true });
      },
    });

    await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_play", { uris: [`${FRESH_URI}_candidate`, "not-spotify", RECENT_URI] }),
    );

    expect(captured).toMatchObject({ uris: [FRESH_URI, RECENT_URI] });
    expect(chat.metadata).toMatchObject({
      spotifyRecentTracks: [FRESH_URI, RECENT_URI, OLD_URI],
    });
  });

  it("remembers only the queued track URIs returned by Spotify play", async () => {
    const chat = { id: "chat-1", mode: "roleplay", metadata: { spotifyRecentTracks: [OLD_URI] } };
    const integrations = spotifyIntegrations({
      async play<T = unknown>() {
        return asValue<T>({ success: true, applied: true, queued: [FRESH_URI] });
      },
    });

    await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_play", { uris: [FRESH_URI, RECENT_URI] }),
    );

    expect(chat.metadata).toMatchObject({
      spotifyRecentTracks: [FRESH_URI, OLD_URI],
    });
  });

  it("does not remember tracks when Spotify play reports failure", async () => {
    const chat = { id: "chat-1", mode: "roleplay", metadata: { spotifyRecentTracks: [OLD_URI] } };
    const integrations = spotifyIntegrations({
      async play<T = unknown>() {
        return asValue<T>({ success: false, applied: false });
      },
    });

    const result = await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_play", { uri: FRESH_URI }),
    );

    expect(result).toMatchObject({ success: false, applied: false });
    expect(chat.metadata).toMatchObject({
      spotifyRecentTracks: [OLD_URI],
    });
  });

  it("stores game Spotify plays in the game recent-track bucket", async () => {
    const chat = {
      id: "chat-1",
      mode: "game",
      metadata: {
        gameUseSpotifyMusic: true,
        gameRecentSpotifyTracks: [RECENT_URI],
        spotifyRecentTracks: [OLD_URI],
      },
    };
    const integrations = spotifyIntegrations({
      async play<T = unknown>() {
        return asValue<T>({ success: true, applied: true });
      },
    });

    await executeBuiltInTool(
      { storage: storageFor(chat), integrations },
      runtimeInput(chat),
      { id: "agent-1" },
      toolCall("spotify_play", { uri: FRESH_URI }),
    );

    expect(chat.metadata).toMatchObject({
      gameRecentSpotifyTracks: [FRESH_URI, RECENT_URI],
      spotifyRecentTracks: [OLD_URI],
    });
  });
});

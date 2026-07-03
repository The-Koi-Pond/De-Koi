import { describe, expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../../../capabilities/llm";
import type { StorageEntity, StorageGateway, StorageListOptions } from "../../../capabilities/storage";
import { analyzeGameScene } from "./game-scene-analysis.service";

type JsonRecord = Record<string, unknown>;

function llmWithResponses(responses: string[]): LlmGateway & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) throw new Error("No queued LLM response");
      return response;
    }),
    stream: vi.fn(),
    listModels: vi.fn(async () => []),
  } as unknown as LlmGateway & { requests: LlmRequest[] };
}

function storageGateway(): StorageGateway {
  const rows: Partial<Record<StorageEntity, JsonRecord[]>> = {
    chats: [{ id: "chat-1", connectionId: "conn-1", metadata: {} }],
    connections: [{ id: "conn-1", provider: "test" }],
  };

  return {
    async list<T = unknown>(entity: StorageEntity, options?: StorageListOptions): Promise<T[]> {
      const records = rows[entity] ?? [];
      if (!options?.filters) return records as T[];
      return records.filter((record) =>
        Object.entries(options.filters ?? {}).every(([key, value]) => record[key] === value),
      ) as T[];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      return ((rows[entity] ?? []).find((record) => record.id === id) ?? null) as T | null;
    },
    async create<T = unknown>(_entity: StorageEntity, value: Record<string, unknown>): Promise<T> {
      return value as T;
    },
    async update<T = unknown>(_entity: StorageEntity, id: string, patch: Record<string, unknown>): Promise<T> {
      return { id, ...patch } as T;
    },
    async delete() {
      return { deleted: false };
    },
    async listChatMessages<T = unknown>() {
      return [] as T[];
    },
    async getChatMessage() {
      return null;
    },
    async createChatMessage<T = unknown>(_chatId: string, value: Record<string, unknown>) {
      return value as T;
    },
    async updateChatMessage<T = unknown>(_messageId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async deleteChatMessage() {
      return { deleted: false };
    },
    async patchChatMessageExtra<T = unknown>() {
      return {} as T;
    },
    async addChatMessageSwipe<T = unknown>() {
      return {} as T;
    },
    async patchChatMetadata<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async patchChatSummaries<T = unknown>(_chatId: string, patch: Record<string, unknown>) {
      return patch as T;
    },
    async listChatMemories() {
      return [];
    },
    async getWorldState<T = unknown>() {
      return {} as T;
    },
    async saveTrackerSnapshot<T = unknown>(_chatId: string, snapshot: Record<string, unknown>) {
      return snapshot as T;
    },
    async listLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async createLorebookEntries<T = unknown>() {
      return [] as T[];
    },
    async promptFull() {
      return null;
    },
  };
}

const baseContext = {
  currentState: "exploration",
  availableBackgrounds: ["backgrounds:forest:path", "backgrounds:tavern:hall"],
  availableSfx: ["sfx:door:slam"],
  activeWidgets: [],
  trackedNpcs: [{ name: "Rhea" }],
  characterNames: ["Rhea"],
  currentBackground: "backgrounds:forest:path",
  currentWeather: "clear",
  currentTimeOfDay: "morning",
  useSpotifyMusic: true,
  availableSpotifyTracks: [{ uri: "spotify:track:valid", name: "Valid Song", artist: "The Testers", album: "Proof" }],
};

const youtubeMusicTrack = {
  provider: "youtube",
  id: "yt:rain-waltz",
  title: "Rain Waltz",
  channelOrArtist: "Test Channel",
  url: "https://www.youtube.com/watch?v=rainwaltz",
  thumbnail: null,
  durationSeconds: 3600,
  confidence: 0.9,
  reasonTags: ["rain", "waltz"],
};

const musicContext = {
  ...baseContext,
  useSpotifyMusic: false,
  availableSpotifyTracks: [],
  useMusicDj: true,
  availableMusicTracks: [youtubeMusicTrack],
  currentMusicTrack: "yt:old-theme",
  recentMusicTracks: ["yt:old-theme"],
};

function validSceneJson(overrides: JsonRecord = {}): string {
  return JSON.stringify({
    background: "backgrounds:tavern:hall",
    weather: "rainy",
    timeOfDay: "evening",
    locationKind: "interior",
    spotifyTrack: "spotify:track:valid",
    reputationChanges: [{ npcName: "Rhea", action: "trust increased" }],
    segmentEffects: [
      {
        segment: 0,
        sfx: ["sfx:door:slam"],
        directions: [{ effect: "flash", duration: 0.5 }],
      },
    ],
    directions: [{ effect: "fade_from_black", duration: 1 }],
    illustration: null,
    ...overrides,
  });
}

describe("analyzeGameScene structured generation", () => {
  it("returns post-processed scene analysis from valid structured JSON", async () => {
    const llm = llmWithResponses([validSceneJson({ spotifyTrack: { uri: "spotify:track:valid" }, elapsedMinutes: 3 })]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "The party enters the tavern.", context: baseContext },
    );

    expect(result.background).toBe("backgrounds:tavern:hall");
    expect(result.weather).toBe("rainy");
    expect(result.locationKind).toBe("interior");
    expect(result.spotifyTrack).toMatchObject({ uri: "spotify:track:valid", name: "Valid Song" });
    expect(result.elapsedMinutes).toBe(3);
    expect(result.segmentEffects?.[0]?.sfx).toEqual(["sfx:door:slam"]);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it("selects a neutral Music Player track only from provided candidates", async () => {
    const llm = llmWithResponses([
      validSceneJson({
        spotifyTrack: undefined,
        musicTrack: "yt:rain-waltz",
        musicGenre: null,
        musicIntensity: null,
      }),
    ]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "Rain drums gently on the tavern roof.", context: musicContext },
    );

    expect(result.musicTrack).toMatchObject({
      provider: "youtube",
      id: "yt:rain-waltz",
      title: "Rain Waltz",
      channelOrArtist: "Test Channel",
    });
    expect(result.spotifyTrack).toBeNull();
    expect(llm.requests[0]?.messages[1]?.content).toContain("MUSIC TRACK OPTIONS");
    expect(llm.requests[0]?.messages[1]?.content).toContain("yt:rain-waltz");
    expect(llm.requests[0]?.messages[1]?.content).not.toContain("SPOTIFY TRACK OPTIONS");
  });

  it("rejects invented neutral Music Player track ids", async () => {
    const llm = llmWithResponses([
      validSceneJson({
        spotifyTrack: undefined,
        musicTrack: "yt:invented",
        musicGenre: null,
        musicIntensity: null,
      }),
    ]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "The room grows quiet.", context: musicContext },
    );

    expect(result.musicTrack).toBeNull();
  });

  it("returns a recoverable failure when Music Player and Spotify are both enabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const llm = llmWithResponses([
      validSceneJson({
        spotifyTrack: "spotify:track:valid",
        musicTrack: "yt:rain-waltz",
      }),
    ]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      {
        chatId: "chat-1",
        narration: "The room grows quiet.",
        context: {
          ...musicContext,
          useSpotifyMusic: true,
          availableSpotifyTracks: baseContext.availableSpotifyTracks,
        },
      },
    );

    expect(result.musicTrack).toBeNull();
    expect(result.spotifyTrack).toBeNull();
    expect(result.structuredFailure).toMatchObject({
      taskName: "game.sceneAnalysis.postprocess",
      message: "Music Player and legacy Spotify scene music cannot both be enabled.",
      validationErrors: ["scene_postprocess_failed"],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Scene postprocess failed"), expect.any(Error));
  });

  it("repairs malformed scene JSON and returns the repaired analysis", async () => {
    const llm = llmWithResponses(["not json", validSceneJson({ background: "backgrounds:forest:path" })]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "The forest path fills with rain.", context: baseContext },
    );

    expect(result.background).toBe("backgrounds:forest:path");
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("game.sceneAnalysis");
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("not json");
  });

  it("repairs schema-invalid enum output before post-processing applies scene changes", async () => {
    const llm = llmWithResponses([validSceneJson({ weather: "lava" }), validSceneJson({ weather: "stormy" })]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "Storm clouds split the sky.", context: baseContext },
    );

    expect(result.weather).toBe("stormy");
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("weather");
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("lava");
  });
  it("repairs out-of-range elapsed-time estimates before post-processing applies scene changes", async () => {
    const llm = llmWithResponses([validSceneJson({ elapsedMinutes: 5000 }), validSceneJson({ elapsedMinutes: 12 })]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "The party searches the market stalls.", context: baseContext },
    );

    expect(result.elapsedMinutes).toBe(12);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("elapsedMinutes");
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("5000");
  });


  it("returns a no-op analysis after final invalid output without malformed fallback mutations", async () => {
    const llm = llmWithResponses([
      "not json",
      validSceneJson({ weather: "lava", spotifyTrack: "spotify:track:valid" }),
    ]);

    const result = await analyzeGameScene(
      { storage: storageGateway(), llm },
      { chatId: "chat-1", narration: "The scene should stay unchanged.", context: baseContext },
    );

    expect(result.background).toBeNull();
    expect(result.weather).toBeNull();
    expect(result.timeOfDay).toBeNull();
    expect(result.spotifyTrack).toBeNull();
    expect(result.segmentEffects).toEqual([]);
    expect(result.directions).toEqual([]);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});

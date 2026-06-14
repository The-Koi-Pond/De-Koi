import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameMap, GameSetupConfig, SessionSummary } from "../../../../engine/contracts/types/game";
import { createDefaultImageStyleProfileSettings } from "../../../../engine/generation/image-style-profiles";
import type { WeatherState } from "../../../../engine/modes/game/world/weather.service";

const storageApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const imageGenerationApiMock = vi.hoisted(() => ({
  generate: vi.fn(),
}));

const spriteApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

const gameAssetsApiMock = vi.hoisted(() => ({
  upload: vi.fn(),
}));

const spotifyApiMock = vi.hoisted(() => ({
  searchTracks: vi.fn(),
  playTrack: vi.fn(),
}));

const urlBinaryApiMock = vi.hoisted(() => ({
  load: vi.fn(),
}));

const chatCommandApiMock = vi.hoisted(() => ({
  branch: vi.fn(),
  bulkDeleteMessages: vi.fn(),
}));

const trackerSnapshotApiMock = vi.hoisted(() => ({
  latest: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
}));

const llmApiMock = vi.hoisted(() => ({
  complete: vi.fn(),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: storageApiMock,
}));

vi.mock("../../../../shared/api/image-generation-api", () => ({
  imageGenerationApi: imageGenerationApiMock,
  spriteApi: spriteApiMock,
}));

vi.mock("../../../../shared/api/assets-api", () => ({
  gameAssetsApi: gameAssetsApiMock,
}));

vi.mock("../../../../shared/api/integration-utility-api", () => ({
  spotifyApi: spotifyApiMock,
}));

vi.mock("../../../../shared/api/url-binary-api", () => ({
  urlBinaryApi: urlBinaryApiMock,
}));

vi.mock("../../../../shared/api/chat-command-api", () => ({
  chatCommandApi: chatCommandApiMock,
}));

vi.mock("../../../../shared/api/tracker-snapshot-api", () => ({
  trackerSnapshotApi: trackerSnapshotApiMock,
}));

vi.mock("../../../../shared/api/llm-api", () => ({
  llmApi: llmApiMock,
}));

import { gameApi } from "./game-api";
import { illustrationReferenceData, imageReviewId, imageSize } from "./game-api-asset-helpers";
import { generateAssets, previewGeneratedAssets } from "./game-api-assets";
import { branchFromCheckpoint, createCheckpoint, deleteCheckpoint, loadCheckpoint } from "./game-api-checkpoints";
import { RESTORED_CHECKPOINT_ANCHOR_META_KEY } from "./game-api-checkpoint-helpers";
import { regenerateSessionLorebook, runGameLorebookKeeperAfterConclusion } from "./game-api-lorebook-keeper";
import { moveOnMap } from "./game-api-map";
import { mapForMovement, moveMapPartyPosition, setupMapFromResponse } from "./game-api-map-helpers";
import { advanceTime, skillCheck, transitionGameState, updateReputation, updateWeather } from "./game-api-mechanics";
import { resolveWeatherUpdate } from "./game-api-mechanics-helpers";
import { partyTurn, removePartyMember, upsertPartyCard } from "./game-api-party";
import { normalizedName, partyCardNameMatches } from "./game-api-party-helpers";
import { applyGameJsonRepair } from "./game-api-repair";
import { createGame, setupGame, updateCampaignProgression } from "./game-api-session";
import { spotifyCandidates } from "./game-api-spotify";
import {
  gameCarryoverPatch,
  nextGameSessionNumber,
  normalizeCampaignProgression,
  normalizeSessionConclusionGenerated,
} from "./game-api-session-helpers";

const fallbackSummary: SessionSummary = {
  sessionNumber: 1,
  summary: "Old summary",
  resumePoint: "Old resume",
  partyDynamics: "Old dynamics",
  partyState: "Old state",
  keyDiscoveries: ["old clue"],
  characterMoments: ["old moment"],
  littleDetails: ["old detail"],
  statsSnapshot: { hp: 7 },
  npcUpdates: ["old npc"],
  nextSessionRequest: null,
  timestamp: "2026-01-01T00:00:00.000Z",
};

const setupConfig: GameSetupConfig = {
  genre: "fantasy",
  setting: "coastal ruins",
  tone: "adventurous",
  difficulty: "normal",
  playerGoals: "explore",
  gmMode: "standalone",
  rating: "sfw",
  partyCharacterIds: ["char-1", "npc:guide"],
};

function gRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const BASIC_SETUP_RESPONSE = {
  worldOverview: "A stormy coast.",
  startingMap: { name: "Harbor" },
  blueprint: {},
  startingNpcs: [],
  characterCards: [],
  storyArc: "Find the gate.",
  plotTwists: [],
  partyArcs: [],
};

const CHECKPOINT_ROW = {
  id: "checkpoint-1",
  chatId: "chat-1",
  label: "Before fight",
  snapshotId: "snapshot-1",
  messageId: "anchor-1",
};

const SNAPSHOT_ROW = {
  id: "snapshot-1",
  chatId: "chat-1",
  gameState: { hp: 2 },
  metadata: { gameWeather: "rain" },
};

function mockChat(chat: Record<string, unknown>) {
  storageApiMock.get.mockImplementation(async (entity: string) => (entity === "chats" ? chat : null));
}

function mockPromptPreviewChat() {
  mockChat({ id: "chat-1", characterIds: [], metadata: { gameSessionNumber: 1 } });
  storageApiMock.list.mockResolvedValue([]);
}

function mockUpdateEcho() {
  storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
    id,
    ...patch,
  }));
}

function readyMetadataPatch(): Record<string, unknown> | undefined {
  return storageApiMock.update.mock.calls.find(
    ([, , patch]) => gRecord(gRecord(patch).metadata).gameSessionStatus === "ready",
  )?.[2] as Record<string, unknown> | undefined;
}

function expectReadyPartyMetadata(currentParty: string[]) {
  expect(readyMetadataPatch()).toEqual(
    expect.objectContaining({
      metadata: expect.objectContaining({
        gamePartyCharacterIds: currentParty,
        gameSetupConfig: expect.objectContaining({ partyCharacterIds: currentParty }),
      }),
    }),
  );
}

function setupCharacterRow(id: string, name: string): Record<string, unknown> {
  return {
    id,
    data: {
      name,
      description: `${name} description`,
      personality: `${name} personality`,
      scenario: `${name} travels with the party.`,
    },
  };
}

function setupGuideNpc() {
  return {
    id: "guide",
    name: "Guide NPC",
    description: "A local guide who knows the academy's locked doors.",
    location: "Moonlit Academy",
    reputation: 12,
    met: true,
    notes: ["Carries a brass key."],
  };
}

function gameImageChat(metadata: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    metadata: {
      enableSpriteGeneration: true,
      gameImageConnectionId: "image-conn",
      gameSessionNumber: 1,
      ...metadata,
    },
  };
}

function partyChat() {
  return {
    id: "chat-1",
    characterIds: ["char-1"],
    metadata: {
      gamePartyCharacterIds: ["char-1"],
      gameCharacterCards: [{ name: "Mira" }],
      gameSetupConfig: { ...setupConfig, partyCharacterIds: ["char-1"] },
    },
  };
}

async function transitionWithCheckpointProbe(
  initialState: "exploration" | "combat",
  newState: "exploration" | "combat",
  hp: number,
) {
  let chat = {
    id: "chat-1",
    metadata: { gameActiveState: initialState },
    gameState: { hp },
  };
  const snapshots: Array<Record<string, unknown>> = [];
  storageApiMock.get.mockImplementation(async (entity: string) => (entity === "chats" ? chat : null));
  storageApiMock.list.mockResolvedValue([{ id: "message-1", createdAt: "2026-01-01T00:00:00.000Z" }]);
  storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
    if (entity === "game-state-snapshots") {
      snapshots.push(value);
      return { id: "snapshot-1", ...value };
    }
    if (entity === "game-checkpoints") return { id: "checkpoint-1", ...value };
    return { id: `${entity}-1`, ...value };
  });
  storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
    chat = { ...chat, ...patch, metadata: { ...chat.metadata, ...gRecord(patch.metadata) } };
    return chat;
  });

  return { result: await transitionGameState({ chatId: "chat-1", newState }), snapshots };
}

function mockCheckpointSnapshotGet(
  chat: Record<string, unknown> | null = null,
  snapshot: Record<string, unknown> = SNAPSHOT_ROW,
) {
  storageApiMock.get.mockImplementation(async (entity: string) => {
    if (entity === "game-checkpoints") return CHECKPOINT_ROW;
    if (entity === "game-state-snapshots") return snapshot;
    if (entity === "chats") return chat;
    return null;
  });
}

describe("game API review guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    trackerSnapshotApiMock.latest.mockResolvedValue(null);
    trackerSnapshotApiMock.get.mockResolvedValue(null);
    trackerSnapshotApiMock.save.mockImplementation(async (_chatId: string, snapshot: Record<string, unknown>) => ({
      kind: "tracker",
      ...snapshot,
    }));
  });

  it("uses kind-specific image size buckets for generated asset previews", () => {
    const payload = {
      imageSizes: {
        background: { width: 512, height: 288 },
        illustration: { width: 640, height: 960 },
      },
    };

    expect(imageSize(payload, "illustration", "width", 1280)).toBe(640);
    expect(imageSize(payload, "illustration", "height", 720)).toBe(960);
    expect(imageSize(payload, "background", "width", 1280)).toBe(512);
  });

  it("honors configured image dimensions through the documented 4096 cap", async () => {
    mockPromptPreviewChat();

    expect(imageSize({ imageSizes: { background: { width: 4096 } } }, "background", "width", 1280)).toBe(4096);
    expect(imageSize({ imageSizes: { background: { width: 4097 } } }, "background", "width", 1280)).toBe(1280);

    const result = await previewGeneratedAssets({
      chatId: "chat-1",
      backgroundTag: "crystal harbor",
      imageSizes: {
        background: { width: 4096, height: 3072 },
      },
    });

    expect(result.items.find((item) => item.kind === "background")).toMatchObject({ width: 4096, height: 3072 });
  });

  it("uses stable prompt review ids for empty or punctuation-only keys", () => {
    expect(imageReviewId("background", "")).toBe("background:generated");
    expect(imageReviewId("background", "!!!")).toBe("background:generated");
    expect(imageReviewId("background", "")).toBe(imageReviewId("background", ""));
  });

  it("previews background and illustration dimensions from separate buckets", async () => {
    mockPromptPreviewChat();

    const result = await previewGeneratedAssets({
      chatId: "chat-1",
      backgroundTag: "forest",
      illustration: { prompt: "a tense bridge duel", slug: "bridge-duel" },
      imageSizes: {
        background: { width: 512, height: 288 },
        illustration: { width: 640, height: 960 },
      },
    });

    expect(result.items.find((item) => item.kind === "background")).toMatchObject({ width: 512, height: 288 });
    expect(result.items.find((item) => item.kind === "illustration")).toMatchObject({ width: 640, height: 960 });
  });

  it("applies prompt overrides with stable generated review ids", async () => {
    mockPromptPreviewChat();

    const result = await previewGeneratedAssets({
      chatId: "chat-1",
      backgroundTag: "!!!",
      promptOverrides: [{ id: "background:generated", prompt: "override prompt" }],
    } as never);

    expect(result.items.find((item) => item.kind === "background")).toMatchObject({ prompt: "override prompt" });
  });

  it("includes NPC gender and pronoun cues in generated portrait prompts", async () => {
    mockPromptPreviewChat();

    const result = await previewGeneratedAssets({
      chatId: "chat-1",
      npcsNeedingAvatars: [
        {
          name: "Vesper",
          description: "masked duelist with silver hair",
          gender: "nonbinary",
          pronouns: "they/them",
        },
      ],
    });

    const portrait = result.items.find((item) => item.kind === "portrait");
    expect(portrait?.prompt).toContain("Gender: nonbinary.");
    expect(portrait?.prompt).toContain("Pronouns: they/them.");
    expect(portrait?.prompt).toContain("masked duelist");
  });

  it("uses the game setup image style profile for generated asset prompts", async () => {
    const styleProfiles = createDefaultImageStyleProfileSettings();
    mockChat({
      id: "chat-1",
      characterIds: [],
      metadata: {
        gameSessionNumber: 1,
        gameSetupConfig: { imageStyleProfileId: "danbooru" },
      },
    });
    storageApiMock.list.mockResolvedValue([]);

    const result = await previewGeneratedAssets({
      chatId: "chat-1",
      backgroundTag: "moonlit shrine",
      imagePromptSettings: {
        styleProfileId: null,
        styleProfiles,
      },
    });

    const background = result.items.find((item) => item.kind === "background");
    expect(background?.prompt).toContain("masterpiece");
    expect(background?.prompt).toContain("scenery");
    expect(background?.negativePrompt).toContain("worst quality");
  });

  it("resolves managed character avatars for illustration references", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "characters") {
        return {
          id: "char-1",
          name: "Mira",
          avatarUrl: "asset://localhost/characters/mira.png",
        };
      }
      return null;
    });
    urlBinaryApiMock.load.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    spriteApiMock.list.mockResolvedValue([]);

    const result = await illustrationReferenceData({
      chat: { id: "chat-1", characterIds: ["char-1"] } as never,
      meta: {},
      illustration: { characters: ["Mira"] },
    });

    expect(result.referenceImages).toHaveLength(1);
    expect(result.referenceImages[0]).toMatch(/^data:image\/png;base64,/);
    expect(result.referenceSubjectNames).toEqual(["Mira"]);
  });

  it("does not add illustration subject names when managed avatars cannot be resolved", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "characters") {
        return {
          id: "char-1",
          name: "Mira",
          avatarUrl: "asset://localhost/characters/mira.png",
        };
      }
      return null;
    });
    urlBinaryApiMock.load.mockRejectedValue(new Error("asset missing"));
    spriteApiMock.list.mockResolvedValue([]);

    const result = await illustrationReferenceData({
      chat: { id: "chat-1", characterIds: ["char-1"] } as never,
      meta: {},
      illustration: { characters: ["Mira"] },
    });

    expect(result.referenceImages).toEqual([]);
    expect(result.referenceSubjectNames).toEqual([]);
  });

  it("fails generated background uploads before metadata changes when base64 is missing", async () => {
    mockChat(gameImageChat());
    imageGenerationApiMock.generate.mockResolvedValue({
      image: "https://provider.example/generated-background.png",
      mimeType: "image/png",
    });

    await expect(
      generateAssets({
        chatId: "chat-1",
        backgroundTag: "forest gate",
      } as never),
    ).rejects.toThrow("Image provider returned no base64 data for background upload.");

    expect(gameAssetsApiMock.upload).not.toHaveBeenCalled();
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("keeps the gameApi asset generation abort signal contract", async () => {
    mockChat(gameImageChat());
    const abort = new AbortController();
    abort.abort();

    await expect(
      gameApi.generateAssets(
        {
          chatId: "chat-1",
          backgroundTag: "forest gate",
        } as never,
        abort.signal,
      ),
    ).rejects.toThrow("The operation was aborted.");

    expect(imageGenerationApiMock.generate).not.toHaveBeenCalled();
  });

  it("passes 4096 dimensions through generated image requests", async () => {
    mockChat(gameImageChat());
    gameAssetsApiMock.upload.mockResolvedValue({ item: { path: "backgrounds/generated/crystal-harbor.png" } });
    imageGenerationApiMock.generate.mockResolvedValue({
      base64: "AQID",
      mimeType: "image/png",
    });

    await generateAssets({
      chatId: "chat-1",
      backgroundTag: "crystal harbor",
      imageSizes: {
        background: { width: 4096, height: 4096 },
      },
    });

    expect(imageGenerationApiMock.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 4096,
        height: 4096,
      }),
    );
  });

  it("adds stored player skill modifiers to unresolved skill checks", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity !== "chats") return null;
      return {
        id: "chat-1",
        metadata: {
          gameCharacterCards: [
            {
              rpgStats: {
                attributes: [{ name: "Wisdom", value: 14 }],
              },
            },
          ],
        },
        gameState: {
          playerStats: {
            skills: {
              perception: 3,
            },
          },
        },
      };
    });

    const result = await skillCheck({
      chatId: "chat-1",
      skill: "Perception",
      dc: 15,
      preRolledD20: 10,
    });

    expect(result.result.modifier).toBe(5);
    expect(result.result.total).toBe(15);
    expect(result.result.success).toBe(true);
  });

  it("returns reputation milestones from updates", async () => {
    const chat = {
      id: "chat-1",
      metadata: {
        gameNpcs: [{ id: "npc-1", name: "Mira", reputation: 15, met: false, notes: [] }],
      },
    };
    mockChat(chat);
    mockUpdateEcho();

    const result = await updateReputation({
      chatId: "chat-1",
      actions: [{ npcId: "npc-1", action: "helped" }],
    });

    expect(result.changes).toMatchObject([{ npcId: "npc-1", npcName: "Mira", action: "helped" }]);
    expect(result.milestones).toMatchObject([
      {
        npcName: "Mira",
        previousTier: "neutral",
        newTier: "friendly",
        direction: "improved",
      },
    ]);
  });

  it("applies party-turn reputation tags before storing clean dialogue", async () => {
    const chat = {
      id: "chat-1",
      characterIds: [],
      metadata: {
        gameNpcs: [{ id: "npc-1", name: "Mira", reputation: 15, met: false, notes: [] }],
        gameCharacterCards: [{ name: "Mira" }],
      },
    };
    mockChat(chat);
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => ({
      id: `${entity}-1`,
      ...value,
    }));
    llmApiMock.complete.mockResolvedValue(
      '[party-turn]\n[Mira] [main]: We can help. [reputation: npc="Mira" action="helped"]',
    );

    const result = await partyTurn({
      chatId: "chat-1",
      narration: "Mira waits.",
      connectionId: "conn-1",
    });

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          gameNpcs: [
            expect.objectContaining({
              id: "npc-1",
              reputation: 30,
              met: true,
            }),
          ],
        }),
      }),
    );
    expect(storageApiMock.create).toHaveBeenCalledWith(
      "messages",
      expect.objectContaining({
        content: "[party-turn]\n[Mira] [main]: We can help.",
        swipes: [{ content: "[party-turn]\n[Mira] [main]: We can help." }],
      }),
    );
    expect(result.raw).toBe("[Mira] [main]: We can help.");
    expect(result.npcs).toMatchObject([{ id: "npc-1", reputation: 30, met: true }]);
  });

  it("resolves party-turn reputation tags by NPC display name when another NPC id collides", async () => {
    const chat = {
      id: "chat-1",
      characterIds: [],
      metadata: {
        gameNpcs: [
          { id: "Mira", name: "Ren", reputation: 10, met: false, notes: [] },
          { id: "npc-2", name: "Mira", reputation: 15, met: false, notes: [] },
        ],
        gameCharacterCards: [{ name: "Mira" }],
      },
    };
    mockChat(chat);
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => ({
      id: `${entity}-1`,
      ...value,
    }));
    llmApiMock.complete.mockResolvedValue(
      '[party-turn]\n[Mira] [main]: We can help. [reputation: npc="Mira" action="helped"]',
    );

    const result = await partyTurn({
      chatId: "chat-1",
      narration: "Mira waits.",
      connectionId: "conn-1",
    });

    expect(result.npcs).toMatchObject([
      { id: "Mira", name: "Ren", reputation: 10, met: false },
      { id: "npc-2", name: "Mira", reputation: 30, met: true },
    ]);
  });

  it.each([
    {
      label: "unknown",
      npcs: [{ id: "npc-1", name: "Mira", reputation: 15, met: false, notes: [] }],
      tagTarget: "Ren",
      expectedError: "not found",
    },
    {
      label: "ambiguous",
      npcs: [
        { id: "npc-1", name: "Mira", reputation: 15, met: false, notes: [] },
        { id: "npc-2", name: "mira", reputation: 10, met: false, notes: [] },
      ],
      tagTarget: "Mira",
      expectedError: "ambiguous",
    },
  ])("rejects $label party-turn reputation targets before storing clean dialogue", async ({ npcs, tagTarget, expectedError }) => {
    const chat = {
      id: "chat-1",
      characterIds: [],
      metadata: {
        gameNpcs: npcs,
        gameCharacterCards: [{ name: "Mira" }],
      },
    };
    mockChat(chat);
    storageApiMock.list.mockResolvedValue([]);
    llmApiMock.complete.mockResolvedValue(
      `[party-turn]\n[Mira] [main]: We can help. [reputation: npc="${tagTarget}" action="helped"]`,
    );

    await expect(
      partyTurn({
        chatId: "chat-1",
        narration: "Mira waits.",
        connectionId: "conn-1",
      }),
    ).rejects.toThrow(expectedError);

    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("cleans up party-turn messages and swipe sidecars when reputation persistence fails", async () => {
    const chat = {
      id: "chat-1",
      characterIds: [],
      metadata: {
        gameNpcs: [{ id: "npc-1", name: "Mira", reputation: 15, met: false, notes: [] }],
        gameCharacterCards: [{ name: "Mira" }],
      },
    };
    mockChat(chat);
    storageApiMock.list.mockResolvedValue([]);
    const persistedMessages = new Map<string, Record<string, unknown>>();
    const persistedMessageSwipes = new Map<string, Array<Record<string, unknown>>>();
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      const id = entity === "messages" ? "message-1" : `${entity}-1`;
      const row = { id, ...value };
      if (entity === "messages") {
        persistedMessages.set(id, row);
        const swipes = Array.isArray(value.swipes)
          ? value.swipes.map((swipe, index) => ({ ...gRecord(swipe), messageId: id, index }))
          : [];
        persistedMessageSwipes.set(id, swipes);
      }
      return row;
    });
    storageApiMock.update.mockRejectedValue(new Error("reputation failed"));
    chatCommandApiMock.bulkDeleteMessages.mockImplementation(async (_chatId: string, messageIds: string[]) => {
      let deleted = 0;
      for (const messageId of messageIds) {
        if (persistedMessages.delete(messageId)) deleted += 1;
        persistedMessageSwipes.delete(messageId);
      }
      return { deleted };
    });
    llmApiMock.complete.mockResolvedValue(
      '[party-turn]\n[Mira] [main]: We can help. [reputation: npc="Mira" action="helped"]',
    );

    await expect(
      partyTurn({
        chatId: "chat-1",
        narration: "Mira waits.",
        connectionId: "conn-1",
      }),
    ).rejects.toThrow("reputation failed");

    expect(chatCommandApiMock.bulkDeleteMessages).toHaveBeenCalledWith("chat-1", ["message-1"]);
    expect(persistedMessages.has("message-1")).toBe(false);
    expect(persistedMessageSwipes.has("message-1")).toBe(false);
    expect(storageApiMock.delete).not.toHaveBeenCalled();
  });

  it("normalizes NPC avatar names through gallery and metadata merge", async () => {
    let chat = {
      id: "chat-1",
      metadata: {
        enableSpriteGeneration: true,
        gameImageConnectionId: "image-conn",
        gameSessionNumber: 1,
        gameNpcs: [{ id: "npc-1", name: "Bob", notes: [] }],
      },
    };
    const galleryCreates: Array<Record<string, unknown>> = [];
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "chats") return chat;
      return null;
    });
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      if (entity === "gallery") {
        galleryCreates.push(value);
        return { id: "gallery-1", url: value.url };
      }
      return { id: `${entity}-1`, ...value };
    });
    storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      chat = { ...chat, ...patch, metadata: { ...chat.metadata, ...gRecord(patch.metadata) } };
      return chat;
    });
    imageGenerationApiMock.generate.mockResolvedValue({
      base64: "AQID",
      mimeType: "image/png",
    });

    const result = await generateAssets({
      chatId: "chat-1",
      npcsNeedingAvatars: [{ name: " Bob ", description: "merchant" }],
    } as never);

    expect(result.generatedNpcAvatars).toMatchObject([{ name: "Bob", avatarGalleryId: "gallery-1" }]);
    expect(galleryCreates[0]).toMatchObject({ characters: ["Bob"] });
    expect(chat.metadata.gameNpcs).toEqual([
      expect.objectContaining({
        id: "npc-1",
        name: "Bob",
        avatarGalleryId: "gallery-1",
      }),
    ]);
  });

  it("rejects movement outside the active map and unknown map ids", () => {
    const gridMap: GameMap = {
      id: "grid",
      type: "grid",
      name: "Grid",
      description: "",
      width: 3,
      height: 3,
      cells: [{ x: 1, y: 1, emoji: "", label: "Start", discovered: true, terrain: "safe" }],
      partyPosition: { x: 1, y: 1 },
    };
    const nodeMap: GameMap = {
      id: "node",
      type: "node",
      name: "Node",
      description: "",
      nodes: [{ id: "hall", emoji: "", label: "Hall", x: 50, y: 50, discovered: true }],
      edges: [],
      partyPosition: "hall",
    };

    expect(moveMapPartyPosition(gridMap, { x: 1, y: 1 }).partyPosition).toEqual({ x: 1, y: 1 });
    expect(() => moveMapPartyPosition(gridMap, { x: 2, y: 2 })).toThrow("known grid cell");
    expect(moveMapPartyPosition(nodeMap, " hall ").partyPosition).toBe("hall");
    expect(() => moveMapPartyPosition(nodeMap, "vault")).toThrow("known map node");
    expect(() => mapForMovement({ gameMaps: [gridMap] }, "missing")).toThrow("Map was not found");
  });

  it("normalizes duplicate setup map node ids and remaps edges", () => {
    const map = setupMapFromResponse({
      startingMap: {
        name: "Ruins",
        regions: [
          { id: "hall", name: "Hall", connectedTo: ["vault"] },
          { id: "hall", name: "Hall Duplicate" },
          { id: "vault", name: "Vault", connectedTo: ["hall"] },
        ],
      },
    });

    expect(map.type).toBe("node");
    expect(map.nodes?.map((node) => node.id)).toEqual(["hall", "hall-2", "vault"]);
    expect(map.edges).toEqual(
      expect.arrayContaining([
        { from: "hall", to: "vault" },
        { from: "vault", to: "hall" },
      ]),
    );
  });

  it.each([
    {
      label: "grid map",
      map: {
        id: "grid",
        type: "grid",
        name: "Grid",
        description: "",
        width: 2,
        height: 1,
        cells: [
          { x: 0, y: 0, emoji: "", label: "Start", discovered: true, terrain: "safe" },
          { x: 1, y: 0, emoji: "", label: "Gate", discovered: false, terrain: "safe" },
        ],
        partyPosition: { x: 0, y: 0 },
      } satisfies GameMap,
      position: { x: 1, y: 0 },
      expectDestination: (map: GameMap) =>
        expect(map.cells?.find((cell) => cell.x === 1 && cell.y === 0)).toMatchObject({ discovered: true }),
      expectedGameMap: {
        partyPosition: { x: 1, y: 0 },
        cells: expect.arrayContaining([expect.objectContaining({ x: 1, y: 0, discovered: true })]),
      },
    },
    {
      label: "node map",
      map: {
        id: "node",
        type: "node",
        name: "Node",
        description: "",
        nodes: [
          { id: "hall", emoji: "", label: "Hall", x: 20, y: 20, discovered: true },
          { id: "vault", emoji: "", label: "Vault", x: 80, y: 80, discovered: false },
        ],
        edges: [{ from: "hall", to: "vault" }],
        partyPosition: "hall",
      } satisfies GameMap,
      position: "vault",
      expectDestination: (map: GameMap) =>
        expect(map.nodes?.find((node) => node.id === "vault")).toMatchObject({ discovered: true }),
      expectedGameMap: {
        partyPosition: "vault",
        nodes: expect.arrayContaining([expect.objectContaining({ id: "vault", discovered: true })]),
      },
    },
  ])("reveals $label destinations when movement succeeds", async ({ map, position, expectDestination, expectedGameMap }) => {
    storageApiMock.get.mockResolvedValue({
      id: "chat-1",
      metadata: { gameMap: map, gameMaps: [map], activeGameMapId: map.id },
    });
    mockUpdateEcho();

    const result = await moveOnMap({ chatId: "chat-1", position } as never);

    expectDestination(result.map);
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          gameMap: expect.objectContaining(expectedGameMap),
        }),
      }),
    );
  });

  it("preserves setup-backed campaign settings during session carryover", () => {
    const carryover = gameCarryoverPatch({
      gameSceneConnectionId: "scene-conn",
      gameImageConnectionId: "image-conn",
      gameUseSpotifyMusic: true,
      gameSpotifySourceType: "playlist",
      gameSpotifyPlaylistId: "playlist-id",
      gameSpotifyPlaylistName: "Road Mix",
      gameSpotifyArtist: "Artist",
      gameGenerationParameters: { temperature: 0.4 },
      gameLanguage: "Japanese",
      gameRating: "nsfw",
      gamePartyCharacterIds: ["char-1"],
      gameLorebookKeeperEnabled: true,
      gameLorebookKeeperLorebookId: "keeper-lorebook",
      gameLorebookKeeperLastRun: { status: "success", sessionNumber: 1 },
      gameSessionLorebookId: "old-session-lorebook",
      gameSessionLorebookEntryCount: 3,
    });

    expect(carryover).toMatchObject({
      gameSceneConnectionId: "scene-conn",
      gameImageConnectionId: "image-conn",
      gameUseSpotifyMusic: true,
      gameSpotifySourceType: "playlist",
      gameSpotifyPlaylistId: "playlist-id",
      gameSpotifyPlaylistName: "Road Mix",
      gameSpotifyArtist: "Artist",
      gameGenerationParameters: { temperature: 0.4 },
      gameLanguage: "Japanese",
      gameRating: "nsfw",
      gamePartyCharacterIds: ["char-1"],
      gameLorebookKeeperEnabled: true,
      gameLorebookKeeperLorebookId: "keeper-lorebook",
    });
    expect(carryover).not.toHaveProperty("gameSessionLorebookId");
    expect(carryover).not.toHaveProperty("gameSessionLorebookEntryCount");
    expect(carryover).not.toHaveProperty("gameLorebookKeeperLastRun");
  });

  it("keeps npc ids out of chat characterIds while preserving game party metadata", async () => {
    const setupWithStaleParty = { ...setupConfig, partyCharacterIds: ["stale-char"] };

    storageApiMock.create.mockImplementation(async (_entity: string, value: Record<string, unknown>) => ({
      id: "chat-1",
      ...value,
    }));

    await createGame({
      name: "New Game",
      setupConfig: setupWithStaleParty,
      partyCharacterIds: ["char-1", "npc:guide"],
    });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({
        characterIds: ["char-1"],
        metadata: expect.objectContaining({
          gamePartyCharacterIds: ["char-1", "npc:guide"],
          gameSetupConfig: expect.objectContaining({
            partyCharacterIds: ["char-1", "npc:guide"],
          }),
        }),
      }),
    );
  });

  it("preserves current party metadata when setup reruns with stale setup config", async () => {
    const staleConfig = { ...setupConfig, partyCharacterIds: ["stale-char"] };
    const currentParty = ["char-1", "npc:guide"];
    const chat = {
      id: "chat-1",
      connectionId: "chat-conn",
      metadata: {
        gameSetupConfig: staleConfig,
        gamePartyCharacterIds: currentParty,
        gameNpcs: [setupGuideNpc()],
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "chats") return chat;
      if (entity === "characters" && id === "char-1") return setupCharacterRow("char-1", "Mira Scout");
      return null;
    });
    mockUpdateEcho();

    await setupGame({
      chatId: "chat-1",
      preferences: "coastal ruins",
      setup: BASIC_SETUP_RESPONSE,
    });

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({
        characterIds: ["char-1"],
      }),
    );
    expectReadyPartyMetadata(currentParty);
  });

  it("passes selected persona, party, GM, and lorebook context into the game setup prompt", async () => {
    const contextualSetupConfig: GameSetupConfig = {
      ...setupConfig,
      gmMode: "character",
      gmCharacterId: "gm-1",
      personaId: "persona-1",
      partyCharacterIds: ["party-1", "npc:guide"],
      activeLorebookIds: ["lorebook-1"],
    };
    const chat = {
      id: "chat-1",
      connectionId: "chat-conn",
      metadata: {
        gameSetupConfig: contextualSetupConfig,
        gamePartyCharacterIds: contextualSetupConfig.partyCharacterIds,
        gameNpcs: [setupGuideNpc()],
      },
    };
    const characterRows: Record<string, Record<string, unknown>> = {
      "gm-1": {
        id: "gm-1",
        data: {
          name: "Archivist GM",
          description: "A fourth-wall aware historian.",
          personality: "Dry, precise, secretly fond.",
          scenario: "Guides a campaign from behind the curtain.",
          extensions: { backstory: "Bound to the ruined academy.", appearance: "Ink-stained robes." },
          tags: ["gm"],
        },
      },
      "party-1": {
        id: "party-1",
        data: {
          name: "Mira Scout",
          description: "A bright-eyed scout with stormglass goggles.",
          personality: "Brave and impulsive.",
          scenario: "Travels with the player.",
          extensions: {
            backstory: "Mira knows the academy's old escape routes.",
            appearance: "Short cloak, brass charms.",
            rpgStats: { attributes: [{ name: "DEX", value: 14 }], hp: { value: 9, max: 9 } },
          },
          tags: ["party"],
        },
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "chats") return chat;
      if (entity === "personas" && id === "persona-1") {
        return {
          id: "persona-1",
          name: "Captain Celia",
          description: "A principled sky-captain.",
          personality: "Warm, stubborn, clever.",
          scenario: "Searching the floating academy.",
          backstory: "Owes a debt to the storm sea.",
          appearance: "Long coat, comet pin.",
        };
      }
      if (entity === "characters") return characterRows[id] ?? null;
      return null;
    });
    storageApiMock.list.mockImplementation(async (entity: string) => {
      if (entity === "lorebooks") return [{ id: "lorebook-1", name: "Academy Lore" }];
      if (entity === "lorebook-entries") {
        return [
          {
            id: "entry-1",
            lorebookId: "lorebook-1",
            name: "Moonlit Doctrine",
            content: "All academy machines obey moon-signed contracts.",
            enabled: true,
            constant: true,
            order: 2,
          },
        ];
      }
      return [];
    });
    llmApiMock.complete.mockResolvedValue(JSON.stringify(BASIC_SETUP_RESPONSE));
    mockUpdateEcho();

    await setupGame({
      chatId: "chat-1",
      connectionId: "gm-conn",
      preferences: "academy mystery",
      setupConfig: contextualSetupConfig,
    });

    const prompt = llmApiMock.complete.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain("<gm_character>");
    expect(prompt).toContain("Archivist GM");
    expect(prompt).toContain("<user_player>");
    expect(prompt).toContain("Captain Celia");
    expect(prompt).toContain("<party_info>");
    expect(prompt).toContain("Mira Scout");
    expect(prompt).toContain("Guide NPC");
    expect(prompt).toContain("Carries a brass key.");
    expect(prompt).toContain('"rpgStats"');
    expect(prompt).toContain("Allowed characterCards names: Captain Celia, Mira Scout, Guide NPC");
    expect(prompt).toContain("Allowed partyArcs names: Mira Scout, Guide NPC");
    expect(prompt).toContain("<lorebook_context>");
    expect(prompt).toContain("Moonlit Doctrine");
    expect(prompt).toContain("All academy machines obey moon-signed contracts.");
  });

  it.each([
    {
      label: "persona",
      config: { ...setupConfig, partyCharacterIds: [], personaId: "missing-persona" },
      expectedMessage: 'Selected game persona "missing-persona" was not found',
    },
    {
      label: "party character",
      config: { ...setupConfig, partyCharacterIds: ["missing-party"] },
      expectedMessage: 'Selected game character "missing-party" was not found',
    },
    {
      label: "party NPC",
      config: { ...setupConfig, partyCharacterIds: ["npc:missing-guide"] },
      expectedMessage: 'Selected game party NPC "npc:missing-guide" was not found',
    },
    {
      label: "GM character",
      config: {
        ...setupConfig,
        gmMode: "character" as const,
        gmCharacterId: "missing-gm",
        partyCharacterIds: [],
      },
      expectedMessage: 'Selected game character "missing-gm" was not found',
    },
  ])("does not generate setup with silently missing selected $label context", async ({ config, expectedMessage }) => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "chats") {
        return {
          id: "chat-1",
          connectionId: "chat-conn",
          metadata: {
            gameSetupConfig: config,
            gamePartyCharacterIds: config.partyCharacterIds,
          },
        };
      }
      return null;
    });
    storageApiMock.list.mockResolvedValue([]);

    await expect(
      setupGame({
        chatId: "chat-1",
        connectionId: "gm-conn",
        preferences: "academy mystery",
        setupConfig: config,
      }),
    ).rejects.toThrow(expectedMessage);
    expect(llmApiMock.complete).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing active lorebook",
      lorebooks: [],
      entries: [],
      expectedMessage: 'Selected game lorebook "lorebook-1" was not found',
    },
    {
      label: "active lorebook with no enabled constant content",
      lorebooks: [{ id: "lorebook-1", name: "Empty Lore" }],
      entries: [
        {
          id: "entry-1",
          lorebookId: "lorebook-1",
          name: "Draft",
          content: "Draft-only lore",
          enabled: true,
          constant: false,
          order: 1,
        },
      ],
      expectedMessage: 'Selected game lorebook "lorebook-1" has no enabled constant setup context',
    },
  ])("does not generate setup with $label", async ({ lorebooks, entries, expectedMessage }) => {
    const config: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: [],
      activeLorebookIds: ["lorebook-1"],
    };
    storageApiMock.get.mockImplementation(async (entity: string) =>
      entity === "chats"
        ? {
            id: "chat-1",
            connectionId: "chat-conn",
            metadata: {
              gameSetupConfig: config,
              gamePartyCharacterIds: config.partyCharacterIds,
            },
          }
        : null,
    );
    storageApiMock.list.mockImplementation(async (entity: string) => {
      if (entity === "lorebooks") return lorebooks;
      if (entity === "lorebook-entries") return entries;
      return [];
    });

    await expect(
      setupGame({
        chatId: "chat-1",
        connectionId: "gm-conn",
        preferences: "academy mystery",
        setupConfig: config,
      }),
    ).rejects.toThrow(expectedMessage);
    expect(llmApiMock.complete).not.toHaveBeenCalled();
  });

  it("does not generate setup when active lorebook context cannot be loaded", async () => {
    const config: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: [],
      activeLorebookIds: ["lorebook-1"],
    };
    storageApiMock.get.mockImplementation(async (entity: string) =>
      entity === "chats"
        ? {
            id: "chat-1",
            connectionId: "chat-conn",
            metadata: {
              gameSetupConfig: config,
              gamePartyCharacterIds: config.partyCharacterIds,
            },
          }
        : null,
    );
    storageApiMock.list.mockRejectedValue(new Error("lorebook storage unavailable"));

    await expect(
      setupGame({
        chatId: "chat-1",
        connectionId: "gm-conn",
        preferences: "academy mystery",
        setupConfig: config,
      }),
    ).rejects.toThrow("lorebook storage unavailable");
    expect(llmApiMock.complete).not.toHaveBeenCalled();
  });

  it("preserves current party metadata through game setup JSON repair", async () => {
    const staleConfig = { ...setupConfig, partyCharacterIds: ["stale-char"] };
    const currentParty = ["char-1", "npc:guide"];
    const chat = {
      id: "chat-1",
      connectionId: "chat-conn",
      metadata: {
        gameSetupConfig: staleConfig,
        gamePartyCharacterIds: currentParty,
        gameNpcs: [setupGuideNpc()],
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "chats") return chat;
      if (entity === "characters" && id === "char-1") return setupCharacterRow("char-1", "Mira Scout");
      return null;
    });
    mockUpdateEcho();

    await applyGameJsonRepair(
      {
        kind: "game_setup",
        applyEndpoint: "/game/repair",
        applyBody: {
          chatId: "chat-1",
          preferences: "coastal ruins",
          setupConfig: staleConfig,
        },
      },
      JSON.stringify(BASIC_SETUP_RESPONSE),
    );

    expectReadyPartyMetadata(currentParty);
  });

  it("validates selected setup context before applying repaired setup JSON", async () => {
    const staleConfig = { ...setupConfig, partyCharacterIds: ["stale-char"] };
    const currentParty = ["npc:missing-guide"];
    storageApiMock.get.mockImplementation(async (entity: string) =>
      entity === "chats"
        ? {
            id: "chat-1",
            connectionId: "chat-conn",
            metadata: {
              gameSetupConfig: staleConfig,
              gamePartyCharacterIds: currentParty,
              gameNpcs: [setupGuideNpc()],
            },
          }
        : null,
    );
    mockUpdateEcho();

    await expect(
      applyGameJsonRepair(
        {
          kind: "game_setup",
          applyEndpoint: "/game/repair",
          applyBody: {
            chatId: "chat-1",
            preferences: "coastal ruins",
            setupConfig: staleConfig,
          },
        },
        JSON.stringify(BASIC_SETUP_RESPONSE),
      ),
    ).rejects.toThrow('Selected game party NPC "npc:missing-guide" was not found');
    expect(readyMetadataPatch()).toBeUndefined();
  });

  it.each([
    {
      label: "library character",
      characterName: "Ren",
      characterId: "char-2",
      generated: { name: "Ren", class: "Scout" },
      expectedCharacterIds: ["char-1", "char-2"],
      expectedPartyIds: ["char-1", "char-2"],
      expectedSetupPartyIds: ["char-1", "char-2"],
    },
    {
      label: "npc",
      characterName: "Guide",
      characterId: "npc:guide",
      generated: { name: "Guide", class: "Guide" },
      expectedCharacterIds: ["char-1"],
      expectedPartyIds: ["char-1", "npc:guide"],
    },
  ])(
    "keeps card and roster metadata coherent when recruiting a $label",
    async ({ characterName, characterId, generated, expectedCharacterIds, expectedPartyIds, expectedSetupPartyIds }) => {
      mockChat(partyChat());
      mockUpdateEcho();

      const result = await upsertPartyCard({
        chatId: "chat-1",
        characterName,
        characterId,
        added: true,
        generated,
      });

      expect(storageApiMock.update).toHaveBeenCalledWith(
        "chats",
        "chat-1",
        expect.objectContaining({ characterIds: expectedCharacterIds }),
      );
      expect(result.sessionChat.metadata).toMatchObject({
        gamePartyCharacterIds: expectedPartyIds,
        ...(expectedSetupPartyIds
          ? { gameSetupConfig: expect.objectContaining({ partyCharacterIds: expectedSetupPartyIds }) }
          : {}),
        gameCharacterCards: expect.arrayContaining([expect.objectContaining({ name: characterName })]),
      });
    },
  );

  it("removes matching party roster ids with party cards", async () => {
    const chat = {
      id: "chat-1",
      characterIds: ["char-1", "char-2"],
      metadata: {
        gamePartyCharacterIds: ["char-1", "char-2", "npc:guide"],
        gameSetupConfig: { ...setupConfig, partyCharacterIds: ["char-1", "char-2", "npc:guide"] },
        gameCharacterCards: [{ name: "Mira" }, { name: "Ren" }, { name: "Guide" }],
        gameNpcs: [{ id: "guide", name: "Guide" }],
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string, id: string) => {
      if (entity === "chats") return chat;
      if (entity === "characters" && id === "char-1") return { id, name: "Mira" };
      if (entity === "characters" && id === "char-2") return { id, name: "Ren" };
      return null;
    });
    storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => ({
      id: "chat-1",
      ...patch,
    }));

    const result = await removePartyMember({ chatId: "chat-1", characterName: "Ren" });

    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({ characterIds: ["char-1"] }),
    );
    expect(result.sessionChat.metadata).toMatchObject({
      gamePartyCharacterIds: ["char-1", "npc:guide"],
      gameCharacterCards: [expect.objectContaining({ name: "Mira" }), expect.objectContaining({ name: "Guide" })],
    });
  });

  it.each([
    {
      label: "start",
      initialState: "exploration",
      newState: "combat",
      hp: 12,
      expectedCreateBeforeUpdate: true,
    },
    {
      label: "end",
      initialState: "combat",
      newState: "exploration",
      hp: 8,
      expectedCreateBeforeUpdate: false,
    },
  ] as const)("creates combat $label checkpoints on the documented side of mutation", async (testCase) => {
    const { result, snapshots } = await transitionWithCheckpointProbe(
      testCase.initialState,
      testCase.newState,
      testCase.hp,
    );

    expect(snapshots[0]?.metadata).toMatchObject({ gameActiveState: "exploration" });
    expect(result.sessionChat.metadata).toMatchObject({ gameActiveState: testCase.newState });
    const [createOrder] = storageApiMock.create.mock.invocationCallOrder;
    const [updateOrder] = storageApiMock.update.mock.invocationCallOrder;
    expect(createOrder < updateOrder).toBe(testCase.expectedCreateBeforeUpdate);
  });

  it("persists time advances to the visible world state", async () => {
    let chat: Record<string, unknown> = {
      id: "chat-1",
      metadata: { gameTime: { day: 1, hour: 8, minute: 0 } },
      gameState: {
        id: "state-1",
        chatId: "chat-1",
        messageId: "",
        swipeIndex: 0,
        time: "Day 1, 08:00 (morning)",
        weather: "clear",
        temperature: "20C",
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string) => (entity === "chats" ? chat : null));
    storageApiMock.list.mockImplementation(async (entity: string) => (entity === "messages" ? [] : []));
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => {
      chat = {
        ...chat,
        ...patch,
        id,
        metadata: { ...gRecord(chat.metadata), ...gRecord(patch.metadata) },
      };
      return chat;
    });

    const result = await advanceTime({ chatId: "chat-1", action: "dialogue" });

    expect(result.formatted).toBe("Day 1, 08:15 (morning)");
    expect(gRecord(chat.metadata).gameTimeFormatted).toBe("Day 1, 08:15 (morning)");
    expect(chat.gameState).toEqual(
      expect.objectContaining({
        time: "Day 1, 08:15 (morning)",
        weather: "clear",
        temperature: "20C",
      }),
    );
  });

  it("persists weather updates to the visible world state", async () => {
    let chat: Record<string, unknown> = {
      id: "chat-1",
      metadata: {},
      gameState: {
        id: "state-1",
        chatId: "chat-1",
        messageId: "",
        swipeIndex: 0,
        time: "Day 1, 08:00 (morning)",
        weather: "clear",
        temperature: "20C",
      },
    };
    storageApiMock.get.mockImplementation(async (entity: string) => (entity === "chats" ? chat : null));
    storageApiMock.list.mockImplementation(async (entity: string) => (entity === "messages" ? [] : []));
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => {
      chat = {
        ...chat,
        ...patch,
        id,
        metadata: { ...gRecord(chat.metadata), ...gRecord(patch.metadata) },
      };
      return chat;
    });

    const result = await updateWeather({ chatId: "chat-1", action: "travel", location: "harbor", type: "rain" });

    expect(result.changed).toBe(true);
    expect(gRecord(gRecord(chat.metadata).gameWeather).type).toBe("rain");
    expect(chat.gameState).toEqual(
      expect.objectContaining({
        time: "Day 1, 08:00 (morning)",
        weather: "rain",
        temperature: expect.stringMatching(/^-?\d+\u00b0C$/),
      }),
    );
  });

  it("derives the next session number from the highest existing session number", () => {
    expect(
      nextGameSessionNumber([
        { metadata: { gameId: "game-1", gameSessionNumber: 1 } },
        { metadata: { gameId: "game-1", gameSessionNumber: 3 } },
        { metadata: { gameId: "game-1", gameSessionNumber: "bad" } },
      ] as never),
    ).toBe(4);
  });

  it("normalizes campaign progression generated from partial or malformed JSON", async () => {
    expect(
      normalizeCampaignProgression(
        { storyArc: "New arc", plotTwists: null, partyArcs: "bad" },
        { storyArc: null, plotTwists: [], partyArcs: [] },
      ),
    ).toEqual({
      storyArc: "New arc",
      plotTwists: [],
      partyArcs: [],
    });

    storageApiMock.get.mockResolvedValue({ id: "chat-1", metadata: { gameId: "game-1" } });
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => ({
      id: "chat-1",
      ...patch,
    }));

    const result = await updateCampaignProgression({
      chatId: "chat-1",
      sessionNumber: 2,
      generated: { storyArc: "Fixed arc" },
    });

    expect(result.sessionChat.id).toBe("chat-1");
    expect(result.targetSessionChat.id).toBe("chat-1");
    expect(result.campaignProgression).toEqual({
      storyArc: "Fixed arc",
      plotTwists: [],
      partyArcs: [],
    });
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          gameCampaignProgression: {
            storyArc: "Fixed arc",
            plotTwists: [],
            partyArcs: [],
          },
        }),
      }),
    );
  });

  it("updates campaign progression from the selected session transcript", async () => {
    const sessions = [
      { id: "chat-current", metadata: { gameId: "game-1", gameSessionNumber: 3 } },
      { id: "chat-target", metadata: { gameId: "game-1", gameSessionNumber: 2 } },
      { id: "other-game", metadata: { gameId: "other", gameSessionNumber: 2 } },
    ];
    const messageListChatIds: string[] = [];
    storageApiMock.get.mockImplementation(async (entity: string, id: string) =>
      entity === "chats" ? (sessions.find((session) => session.id === id) ?? null) : null,
    );
    storageApiMock.list.mockImplementation(async (entity: string, options?: Record<string, unknown>) => {
      if (entity === "chats") return sessions;
      if (entity === "messages") {
        const filters = gRecord(options?.filters);
        messageListChatIds.push(String(filters.chatId ?? ""));
        return filters.chatId === "chat-target"
          ? [{ role: "assistant", content: "The party recovered the tide key." }]
          : [{ role: "assistant", content: "Wrong session transcript." }];
      }
      return [];
    });
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));

    const result = await updateCampaignProgression({ chatId: "chat-current", sessionNumber: 2 });

    expect(messageListChatIds).toEqual(["chat-target"]);
    expect(result.sessionChat.id).toBe("chat-current");
    expect(result.targetSessionChat.id).toBe("chat-target");
    expect(result.campaignProgression).toEqual({
      storyArc: "Session 2 advanced the campaign.",
      plotTwists: [],
      partyArcs: [],
    });
    expect(result.targetSessionChat.metadata).toEqual(
      expect.objectContaining({
        gameCampaignProgression: result.campaignProgression,
      }),
    );
    expect(storageApiMock.update).toHaveBeenCalledTimes(1);
    expect(storageApiMock.update).toHaveBeenCalledWith(
      "chats",
      "chat-target",
      expect.objectContaining({
        metadata: expect.objectContaining({
          gameCampaignProgression: result.campaignProgression,
        }),
      }),
    );
  });

  it("does not activate a newly created keeper lorebook when entry creation fails", async () => {
    const chat = { id: "chat-1", name: "Game", metadata: { activeLorebookIds: ["existing-lorebook"] } };
    storageApiMock.get.mockResolvedValue(chat);
    storageApiMock.list.mockResolvedValue([]);
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      if (entity === "lorebooks") return { id: "new-lorebook", ...value };
      if (entity === "lorebook-entries") throw new Error("entry failed");
      return { id: `${entity}-1`, ...value };
    });
    storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => ({
      id: "chat-1",
      ...patch,
    }));

    const result = await runGameLorebookKeeperAfterConclusion({
      chat: chat as never,
      meta: chat.metadata,
      sessionNumber: 2,
      summary: fallbackSummary,
      generated: { entries: [{ name: "Session clue", content: "A clue.", keys: ["clue"] }] },
    });

    expect(result.lorebookId).toBeNull();
    const chatUpdates = storageApiMock.update.mock.calls.filter(([entity]) => entity === "chats");
    expect(chatUpdates).toHaveLength(2);
    for (const update of chatUpdates) {
      expect(update[2]).not.toEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            activeLorebookIds: expect.arrayContaining(["new-lorebook"]),
          }),
        }),
      );
    }
  });

  it("activates a newly created keeper lorebook only after entries commit", async () => {
    const chat = { id: "chat-1", name: "Game", metadata: { activeLorebookIds: ["existing-lorebook"] } };
    const createdEntries: Array<Record<string, unknown>> = [];
    storageApiMock.get.mockResolvedValue(chat);
    storageApiMock.list.mockImplementation(async (entity: string) => {
      if (entity === "lorebook-entries") return createdEntries;
      return [];
    });
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      if (entity === "lorebooks") return { id: "new-lorebook", ...value };
      if (entity === "lorebook-entries") {
        const entry = { id: "entry-1", ...value };
        createdEntries.push(entry);
        return entry;
      }
      return { id: `${entity}-1`, ...value };
    });
    storageApiMock.update.mockImplementation(async (_entity: string, _id: string, patch: Record<string, unknown>) => ({
      id: "chat-1",
      ...patch,
    }));

    const result = await runGameLorebookKeeperAfterConclusion({
      chat: chat as never,
      meta: chat.metadata,
      sessionNumber: 2,
      summary: fallbackSummary,
      generated: { entries: [{ name: "Session clue", content: "A clue.", keys: ["clue"] }] },
    });

    expect(result).toMatchObject({ lorebookId: "new-lorebook", entryCount: 1 });
    const finalChatUpdate = storageApiMock.update.mock.calls.filter(([entity]) => entity === "chats").at(-1);
    expect(finalChatUpdate?.[2]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          gameLorebookKeeperLorebookId: "new-lorebook",
          activeLorebookIds: ["existing-lorebook", "new-lorebook"],
          gameLorebookKeeperLastRun: expect.objectContaining({
            status: "success",
            lorebookId: "new-lorebook",
            entryCount: 1,
          }),
        }),
      }),
    );
  });

  it("rejects session lorebook regeneration outside game chats", async () => {
    storageApiMock.get.mockResolvedValue({
      id: "chat-1",
      mode: "conversation",
      metadata: {
        gameLorebookKeeperEnabled: true,
        gamePreviousSessionSummaries: [fallbackSummary],
      },
    });

    await expect(
      regenerateSessionLorebook({
        chatId: "chat-1",
        sessionNumber: 1,
        generated: { entries: [{ name: "Lore", content: "Lore.", keys: ["lore"] }] },
      }),
    ).rejects.toThrow("Game Lorebook Keeper can only regenerate game chats.");
    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("rejects session lorebook regeneration when keeper is disabled", async () => {
    storageApiMock.get.mockResolvedValue({
      id: "chat-1",
      mode: "game",
      metadata: {
        gameLorebookKeeperEnabled: false,
        gamePreviousSessionSummaries: [fallbackSummary],
      },
    });

    await expect(
      regenerateSessionLorebook({
        chatId: "chat-1",
        sessionNumber: 1,
        generated: { entries: [{ name: "Lore", content: "Lore.", keys: ["lore"] }] },
      }),
    ).rejects.toThrow("Game Lorebook Keeper is disabled for this chat.");
    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("rejects session lorebook regeneration without a stored session summary", async () => {
    storageApiMock.get.mockResolvedValue({
      id: "chat-1",
      mode: "game",
      metadata: {
        gameLorebookKeeperEnabled: true,
        gamePreviousSessionSummaries: [{ ...fallbackSummary, sessionNumber: 2 }],
      },
    });

    await expect(
      regenerateSessionLorebook({
        chatId: "chat-1",
        sessionNumber: 1,
        generated: { entries: [{ name: "Lore", content: "Lore.", keys: ["lore"] }] },
      }),
    ).rejects.toThrow("Stored session 1 summary was not found.");
    expect(storageApiMock.create).not.toHaveBeenCalled();
    expect(storageApiMock.update).not.toHaveBeenCalled();
  });

  it("regenerates session lorebook after game, enabled, and stored-summary guards pass", async () => {
    const chat = {
      id: "chat-1",
      name: "Game",
      mode: "game",
      metadata: {
        gameLorebookKeeperEnabled: true,
        gamePreviousSessionSummaries: [fallbackSummary],
        activeLorebookIds: ["existing-lorebook"],
      },
    };
    const createdEntries: Array<Record<string, unknown>> = [];
    storageApiMock.get.mockImplementation(async (entity: string) => (entity === "chats" ? chat : null));
    storageApiMock.list.mockImplementation(async (entity: string) => {
      if (entity === "messages") return [];
      if (entity === "lorebook-entries") return createdEntries;
      return [];
    });
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      if (entity === "lorebooks") return { id: "new-lorebook", ...value };
      if (entity === "lorebook-entries") {
        const entry = { id: `entry-${createdEntries.length + 1}`, ...value };
        createdEntries.push(entry);
        return entry;
      }
      return { id: `${entity}-1`, ...value };
    });
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));

    const result = await regenerateSessionLorebook({
      chatId: "chat-1",
      sessionNumber: 1,
      generated: { entries: [{ name: "Session clue", content: "A clue.", keys: ["clue"] }] },
    });

    expect(result).toMatchObject({ sessionNumber: 1, lorebookId: "new-lorebook", entryCount: 1 });
    const finalChatUpdate = storageApiMock.update.mock.calls.filter(([entity]) => entity === "chats").at(-1);
    expect(finalChatUpdate?.[2]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          activeLorebookIds: ["existing-lorebook", "new-lorebook"],
          gameLorebookKeeperLastRun: expect.objectContaining({
            sessionNumber: 1,
            status: "success",
          }),
        }),
      }),
    );
  });

  it("keeps campaign progression when repaired conclusion JSON omits siblings", () => {
    const fallback = {
      summary: fallbackSummary,
      campaignProgression: { storyArc: "Keep this arc" },
      characterCards: [{ name: "Mira" }],
    };

    expect(
      normalizeSessionConclusionGenerated({ summary: { summary: "Fixed summary" } }, fallback).campaignProgression,
    ).toEqual({ storyArc: "Keep this arc" });
    expect(
      normalizeSessionConclusionGenerated(
        {
          summary: { summary: "Fixed summary" },
          campaignProgression: { storyArc: "New arc" },
          characterCards: [{ name: "Ren" }],
        },
        fallback,
      ),
    ).toMatchObject({
      summary: { summary: "Fixed summary" },
      campaignProgression: { storyArc: "New arc" },
      characterCards: [{ name: "Ren" }],
    });
  });

  it("returns existing persisted weather on no-change rolls", () => {
    const existing: WeatherState = {
      type: "rain",
      temperature: 18,
      description: "Rain keeps falling.",
      wind: "breezy",
      visibility: "reduced",
    };
    const forced: WeatherState = {
      type: "clear",
      temperature: 24,
      description: "The weather is clear.",
      wind: "calm",
      visibility: "clear",
    };

    expect(resolveWeatherUpdate(existing, forced, false)).toEqual({
      changed: false,
      weather: existing,
      shouldPersist: false,
    });
    expect(resolveWeatherUpdate(existing, forced, true)).toEqual({
      changed: true,
      weather: forced,
      shouldPersist: true,
    });
  });

  it("does not report Spotify runtime search failures as disabled", async () => {
    spotifyApiMock.searchTracks.mockRejectedValue(new Error("Spotify network failed"));

    await expect(spotifyCandidates({ narration: "storming the gate" })).rejects.toThrow("Spotify network failed");
  });

  it("reports known unconnected Spotify as disabled", async () => {
    spotifyApiMock.searchTracks.mockRejectedValue(
      new Error("Spotify is not connected. Open the Spotify DJ agent and connect your account."),
    );

    await expect(spotifyCandidates({ narration: "storming the gate" })).resolves.toMatchObject({
      enabled: false,
      tracks: [],
      error: "Spotify is not connected. Open the Spotify DJ agent and connect your account.",
    });
  });

  it("normalizes Spotify search limits before calling the shared API", async () => {
    spotifyApiMock.searchTracks.mockResolvedValue({ enabled: true, tracks: [] });

    await spotifyCandidates({ narration: "storming the gate", limit: "bad" });
    await spotifyCandidates({ narration: "storming the gate", limit: -2 });
    await spotifyCandidates({ narration: "storming the gate", limit: 500 });
    await spotifyCandidates({ narration: "storming the gate", limit: 2.4 });

    expect(spotifyApiMock.searchTracks.mock.calls.map(([input]) => gRecord(input).limit)).toEqual([50, 1, 50, 2]);
  });

  it("matches party cards by trimmed case-normalized names", () => {
    expect(partyCardNameMatches({ name: "  MIRA  " }, normalizedName("mira"))).toBe(true);
    expect(partyCardNameMatches({ name: "Mira" }, normalizedName("ren"))).toBe(false);
  });

  it.each([
    {
      label: "deletes owned checkpoint snapshots after deleting the checkpoint row",
      deleted: true,
      expected: { ok: true },
      deleteCalls: [
        ["game-checkpoints", "checkpoint-1"],
        ["game-state-snapshots", "snapshot-1"],
      ],
    },
    {
      label: "does not delete checkpoint snapshots when checkpoint delete is not confirmed",
      deleted: false,
      expected: { ok: false },
      deleteCalls: [["game-checkpoints", "checkpoint-1"]],
    },
  ])("$label", async ({ deleted, expected, deleteCalls }) => {
    storageApiMock.get.mockResolvedValue({ id: "checkpoint-1", snapshotId: "snapshot-1" });
    storageApiMock.delete.mockResolvedValue({ deleted });

    await expect(deleteCheckpoint("checkpoint-1")).resolves.toEqual(expected);

    expect(storageApiMock.delete).toHaveBeenCalledTimes(deleteCalls.length);
    deleteCalls.forEach(([entity, id], index) => {
      expect(storageApiMock.delete).toHaveBeenNthCalledWith(index + 1, entity, id);
    });
  });

  it("surfaces checkpoint snapshot cleanup failure without hiding checkpoint deletion", async () => {
    storageApiMock.get.mockResolvedValue({ id: "checkpoint-1", snapshotId: "snapshot-1" });
    storageApiMock.delete.mockImplementation(async (entity: string) => {
      if (entity === "game-state-snapshots") throw new Error("snapshot cleanup failed");
      return { deleted: true };
    });

    await expect(deleteCheckpoint("checkpoint-1")).resolves.toEqual({
      ok: true,
      snapshotCleanupWarning: {
        snapshotId: "snapshot-1",
        message: "snapshot cleanup failed",
      },
    });
  });

  it("cleans up a checkpoint branch when snapshot patching fails", async () => {
    mockCheckpointSnapshotGet(null, { ...SNAPSHOT_ROW, gameState: { hp: 9 } });
    chatCommandApiMock.branch.mockResolvedValue({ id: "branch-1" });
    storageApiMock.update.mockRejectedValue(new Error("patch failed"));
    storageApiMock.delete.mockResolvedValue({ deleted: true });

    await expect(branchFromCheckpoint({ chatId: "chat-1", checkpointId: "checkpoint-1" })).rejects.toThrow(
      "patch failed",
    );

    expect(storageApiMock.delete).toHaveBeenCalledWith("chats", "branch-1");
  });

  it("patches checkpoint branches with snapshot game state and metadata", async () => {
    mockCheckpointSnapshotGet(null, { ...SNAPSHOT_ROW, gameState: { hp: 9 } });
    chatCommandApiMock.branch.mockResolvedValue({ id: "branch-1" });
    storageApiMock.update.mockImplementation(async (_entity: string, id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));

    await expect(branchFromCheckpoint({ chatId: "chat-1", checkpointId: "checkpoint-1" })).resolves.toMatchObject({
      id: "branch-1",
      gameState: { hp: 9 },
      metadata: expect.objectContaining({
        gameWeather: "rain",
        branchedFromCheckpointId: "checkpoint-1",
      }),
    });
  });

  it("reports snapshot cleanup failure when checkpoint creation rolls back", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "chats") return { id: "chat-1", metadata: {}, gameState: {} };
      return null;
    });
    storageApiMock.list.mockResolvedValue([{ id: "message-1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => {
      if (entity === "game-state-snapshots") return { id: "snapshot-1", ...value };
      if (entity === "game-checkpoints") throw new Error("checkpoint create failed");
      return { id: `${entity}-1`, ...value };
    });
    storageApiMock.delete.mockRejectedValue(new Error("snapshot delete failed"));

    await expect(
      createCheckpoint({ chatId: "chat-1", label: "Before fight", triggerType: "manual" }),
    ).rejects.toThrow(
      "Checkpoint creation failed: checkpoint create failed; snapshot snapshot-1 cleanup failed: snapshot delete failed",
    );
  });

  it("copies current location, weather, and time summaries into checkpoint rows", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "chats") {
        return {
          id: "chat-1",
          metadata: {},
          gameState: {
            location: "Moonlit Harbor",
            weather: "rain",
            time: "Day 2, 21:00 (night)",
          },
        };
      }
      return null;
    });
    storageApiMock.list.mockResolvedValue([{ id: "message-1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => ({
      id: entity === "game-state-snapshots" ? "snapshot-1" : "checkpoint-1",
      ...value,
    }));

    await createCheckpoint({ chatId: "chat-1", label: "Before storm", triggerType: "manual" });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "game-checkpoints",
      expect.objectContaining({
        location: "Moonlit Harbor",
        weather: "rain",
        timeOfDay: "Day 2, 21:00 (night)",
      }),
    );
  });

  it("uses fresher metadata summaries when checkpoint mirrored state is stale", async () => {
    storageApiMock.get.mockImplementation(async (entity: string) => {
      if (entity === "chats") {
        return {
          id: "chat-1",
          metadata: {
            gameWeather: { type: "rain" },
            gameTimeFormatted: "Day 2, 21:00 (night)",
          },
          gameState: {
            location: "Moonlit Harbor",
            weather: "clear",
            time: "Day 1, 08:00 (morning)",
          },
        };
      }
      return null;
    });
    storageApiMock.list.mockResolvedValue([{ id: "message-1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    storageApiMock.create.mockImplementation(async (entity: string, value: Record<string, unknown>) => ({
      id: entity === "game-state-snapshots" ? "snapshot-1" : "checkpoint-1",
      ...value,
    }));

    await createCheckpoint({ chatId: "chat-1", label: "After storm", triggerType: "manual" });

    expect(storageApiMock.create).toHaveBeenCalledWith(
      "game-checkpoints",
      expect.objectContaining({
        location: "Moonlit Harbor",
        weather: "rain",
        timeOfDay: "Day 2, 21:00 (night)",
      }),
    );
  });

  it("rolls checkpoint restore state back when restore marker creation fails", async () => {
    const previousChat = { id: "chat-1", metadata: { gameWeather: "old" }, gameState: { hp: 1 } };
    mockCheckpointSnapshotGet(previousChat);
    storageApiMock.update.mockResolvedValue({ id: "chat-1" });
    storageApiMock.create.mockRejectedValue(new Error("marker failed"));

    await expect(loadCheckpoint({ chatId: "chat-1", checkpointId: "checkpoint-1" })).rejects.toThrow("marker failed");

    expect(storageApiMock.update).toHaveBeenNthCalledWith(
      1,
      "chats",
      "chat-1",
      expect.objectContaining({
        gameState: { hp: 2 },
        metadata: expect.objectContaining({ [RESTORED_CHECKPOINT_ANCHOR_META_KEY]: "anchor-1" }),
      }),
    );
    expect(storageApiMock.update).toHaveBeenNthCalledWith(2, "chats", "chat-1", {
      gameState: { hp: 1 },
      metadata: { gameWeather: "old" },
    });
  });

  it("returns coherent checkpoint restore metadata when marker creation succeeds", async () => {
    mockCheckpointSnapshotGet({ id: "chat-1", metadata: { gameWeather: "old" }, gameState: { hp: 1 } });
    storageApiMock.update.mockResolvedValue({ id: "chat-1" });
    storageApiMock.create.mockResolvedValue({ id: "restore-message-1" });

    const result = await loadCheckpoint({ chatId: "chat-1", checkpointId: "checkpoint-1" });

    expect(result).toMatchObject({
      ok: true,
      messageId: "restore-message-1",
      gameState: { hp: 2 },
      metadata: {
        gameWeather: "rain",
        [RESTORED_CHECKPOINT_ANCHOR_META_KEY]: "anchor-1",
      },
    });
    expect(storageApiMock.update).toHaveBeenCalledTimes(1);
  });
});

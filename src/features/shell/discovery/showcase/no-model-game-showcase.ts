import { storageApi } from "../../../../shared/api/storage-api";
import type { Chat } from "../../../../engine/contracts/types/chat";

export const NO_MODEL_GAME_SHOWCASE_ID = "no-model-game-v1";
export const NO_MODEL_GAME_SHOWCASE_CHAT_ID = "showcase-no-model-game-v1-chat";

const SHOWCASE_VERSION = 1;
const PERSONA_ID = "showcase-no-model-game-v1-persona";
const CHARACTER_A_ID = "showcase-no-model-game-v1-character-mira";
const CHARACTER_B_ID = "showcase-no-model-game-v1-character-tamsin";
const LOREBOOK_ID = "showcase-no-model-game-v1-lorebook";
const LOREBOOK_ENTRY_BELLS_ID = "showcase-no-model-game-v1-lore-entry-bells";
const LOREBOOK_ENTRY_TOKEN_ID = "showcase-no-model-game-v1-lore-entry-token";
const SHOWCASE_SEED_READY = "ready";
const SHOWCASE_SEED_PENDING = "pending";

const SHOWCASE_META = {
  showcaseKey: NO_MODEL_GAME_SHOWCASE_ID,
  showcaseVersion: SHOWCASE_VERSION,
};

type StorageEntity = "characters" | "personas" | "lorebooks" | "lorebook-entries" | "chats";

type CreatedRecord = { entity: StorageEntity | "messages"; id: string };

async function createIfMissing<T = Record<string, unknown>>(
  entity: StorageEntity,
  id: string,
  value: Record<string, unknown>,
  createdRecords?: CreatedRecord[],
): Promise<T> {
  const existing = await storageApi.get<T>(entity, id);
  if (existing) return existing;
  const created = await storageApi.create<T>(entity, { id, ...value });
  createdRecords?.push({ entity, id });
  return created;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rollbackCreatedRecords(createdRecords: CreatedRecord[]): Promise<string[]> {
  const failures: string[] = [];
  for (const record of [...createdRecords].reverse()) {
    try {
      await storageApi.delete(record.entity, record.id);
    } catch (error) {
      failures.push(`${record.entity}/${record.id}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

function characterRecord(name: string, description: string, personality: string, scenario: string) {
  return {
    metadata: SHOWCASE_META,
    data: {
      name,
      description,
      personality,
      scenario,
      first_mes: "",
      mes_example: "",
      creator_notes: "Seeded De-Koi no-model showcase character.",
      system_prompt: "",
      post_history_instructions: "",
      tags: ["showcase", "game"],
      creator: "The Koi Pond",
      character_version: "1",
      alternate_greetings: [],
      extensions: {
        talkativeness: 0.55,
        fav: false,
        world: "Glasswake",
        backstory: description,
        appearance: "",
      },
      character_book: null,
    },
  };
}

const showcaseMap = {
  id: "glasswake-harbor",
  name: "Glasswake Harbor",
  description: "A lantern-lit harbor where mirror-bright canals carry messages between archive towers.",
  nodes: [
    { id: "dock", label: "Moonlit Dock", x: 24, y: 56, discovered: true },
    { id: "archive", label: "Tide Archive", x: 54, y: 34, discovered: true },
    { id: "gate", label: "Saltglass Gate", x: 76, y: 62, discovered: false },
  ],
  edges: [
    { from: "dock", to: "archive" },
    { from: "archive", to: "gate" },
  ],
  partyPosition: "dock",
};

const showcaseJournal = {
  entries: [
    {
      id: "showcase-journal-1",
      type: "location",
      title: "Moonlit Dock",
      content: "The party arrived at Glasswake as the harbor bells counted a missing thirteenth note.",
      createdAt: "2026-06-22T12:00:00.000Z",
    },
    {
      id: "showcase-journal-2",
      type: "quest",
      title: "Find the Thirteenth Bell",
      content: "A silent bell in the Tide Archive may reveal why the Saltglass Gate has begun to hum.",
      createdAt: "2026-06-22T12:05:00.000Z",
    },
  ],
  npcLog: [
    {
      id: "showcase-npc-keeper-lio",
      npcName: "Keeper Lio",
      location: "Tide Archive",
      notes: ["Knows the harbor bell rituals.", "Will help if shown a recovered tide-token."],
    },
  ],
  inventoryLog: [{ itemName: "tide-token", quantity: 1, note: "Warm when carried near the archive doors." }],
  locationLog: [{ name: "Glasswake Harbor", description: "Canals, bell towers, and reflected moonlight." }],
};

const showcaseMessages = [
  {
    id: "showcase-no-model-game-v1-message-1",
    role: "system",
    content: "[session-recap]\nThe party has reached Glasswake Harbor to investigate a silent bell.",
    extra: { hiddenFromAi: false, isSessionRecap: true, ...SHOWCASE_META },
  },
  {
    id: "showcase-no-model-game-v1-message-2",
    role: "assistant",
    content:
      "Glasswake opens around you in rings of lamplight and black water. The Moonlit Dock creaks underfoot while the Tide Archive glows inland, its tallest bell tower holding one dark, silent bell.",
    extra: { displayText: null, isGenerated: true, tokenCount: null, generationInfo: null, ...SHOWCASE_META },
  },
  {
    id: "showcase-no-model-game-v1-message-3",
    role: "user",
    content: "Mira checks the tide-token while Tamsin watches the archive windows.",
    extra: { displayText: null, isGenerated: false, tokenCount: null, generationInfo: null, ...SHOWCASE_META },
  },
  {
    id: "showcase-no-model-game-v1-message-4",
    role: "assistant",
    content:
      "The tide-token warms in Mira's palm. Across the canal, Keeper Lio lifts a lantern in answer, then points toward the Saltglass Gate as if the silent bell has already named your next step.",
    extra: { displayText: null, isGenerated: true, tokenCount: null, generationInfo: null, ...SHOWCASE_META },
  },
] as const;

async function seedMessages(createdRecords: CreatedRecord[]) {
  const existingMessages = await storageApi.listChatMessages<Record<string, unknown>>(NO_MODEL_GAME_SHOWCASE_CHAT_ID);
  const existingIds = new Set(existingMessages.map((message) => String(message.id ?? "")));
  for (const message of showcaseMessages) {
    if (existingIds.has(message.id)) continue;
    await storageApi.createChatMessage(NO_MODEL_GAME_SHOWCASE_CHAT_ID, {
      ...message,
      characterId: null,
      activeSwipeIndex: 0,
    });
    createdRecords.push({ entity: "messages", id: message.id });
  }
}

function chatMetadata(seedStatus: typeof SHOWCASE_SEED_PENDING | typeof SHOWCASE_SEED_READY) {
  return {
    ...SHOWCASE_META,
    showcaseSeedStatus: seedStatus,
    activeLorebookIds: [LOREBOOK_ID],
    gameId: "showcase-no-model-game-v1",
    gameSessionNumber: 1,
    gameSessionStatus: "active",
    gameActiveState: "exploration",
    gameWorldOverview:
      "Glasswake Harbor is a compact mystery setting built to show De-Koi's Game mode without requiring a model.",
    gameSetupConfig: {
      genre: "cozy mystery fantasy",
      setting: "Glasswake Harbor",
      tone: "curious, warm, lightly suspenseful",
      difficulty: "gentle",
      playerGoals: "Find why the hidden thirteenth bell has gone silent.",
      partyCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID],
      activeLorebookIds: [LOREBOOK_ID],
    },
    gameMap: showcaseMap,
    gameMaps: [showcaseMap],
    activeGameMapId: showcaseMap.id,
    gameNpcs: [
      {
        id: "keeper-lio",
        name: "Keeper Lio",
        location: "Tide Archive",
        reputation: 15,
        met: true,
        notes: ["Carries a lantern with blue glass.", "Trusts careful listeners."],
      },
    ],
    gameJournal: showcaseJournal,
    gameWidgetState: [
      {
        id: "showcase-party",
        type: "stat_block",
        label: "Party",
        position: "hud_left",
        config: {
          stats: [
            { name: "Lead", value: "Silent bell" },
            { name: "Token", value: "Warm" },
          ],
        },
      },
      {
        id: "showcase-world",
        type: "stat_block",
        label: "World",
        position: "hud_right",
        config: {
          stats: [
            { name: "Location", value: "Moonlit Dock" },
            { name: "Mood", value: "Watchful" },
          ],
        },
      },
    ],
    gamePreviousSessionSummaries: [],
    gameCampaignProgression: {
      storyArc: "The party is investigating the silent thirteenth bell before the Saltglass Gate wakes fully.",
      plotTwists: ["Keeper Lio knows more about the gate than he says."],
      partyArcs: [],
    },
    gameTime: { day: 1, hour: 20, minute: 15, label: "Day 1, 20:15" },
  };
}

async function verifyShowcaseComplete() {
  const requiredRecords: Array<[StorageEntity, string]> = [
    ["personas", PERSONA_ID],
    ["characters", CHARACTER_A_ID],
    ["characters", CHARACTER_B_ID],
    ["lorebooks", LOREBOOK_ID],
    ["lorebook-entries", LOREBOOK_ENTRY_BELLS_ID],
    ["lorebook-entries", LOREBOOK_ENTRY_TOKEN_ID],
    ["chats", NO_MODEL_GAME_SHOWCASE_CHAT_ID],
  ];
  const records = await Promise.all(requiredRecords.map(([entity, id]) => storageApi.get(entity, id)));
  const missingRecord = records.findIndex((record) => !record);
  if (missingRecord >= 0) {
    const [entity, id] = requiredRecords[missingRecord];
    throw new Error(`Showcase seed is missing ${entity}/${id}.`);
  }

  const existingMessages = await storageApi.listChatMessages<Record<string, unknown>>(NO_MODEL_GAME_SHOWCASE_CHAT_ID);
  const existingMessageIds = new Set(existingMessages.map((message) => String(message.id ?? "")));
  const missingMessage = showcaseMessages.find((message) => !existingMessageIds.has(message.id));
  if (missingMessage) throw new Error(`Showcase seed is missing message ${missingMessage.id}.`);
}

async function seedNoModelGameShowcase(createdRecords: CreatedRecord[]) {
  await createIfMissing(
    "personas",
    PERSONA_ID,
    {
      name: "Ari Vale",
      description: "A curious traveler cataloging strange places and kinder mysteries.",
      personality: "Observant, gently bold, and quick to ask useful questions.",
      scenario: "Ari travels with Mira and Tamsin through Glasswake Harbor.",
      tags: ["showcase", "game"],
      metadata: SHOWCASE_META,
    },
    createdRecords,
  );

  await createIfMissing(
    "characters",
    CHARACTER_A_ID,
    characterRecord(
      "Mira Quill",
      "A field archivist who reads objects by touch and keeps meticulous notes.",
      "Precise, warm, and braver after she has named what frightens her.",
      "Mira is helping investigate Glasswake's silent thirteenth bell.",
    ),
    createdRecords,
  );
  await createIfMissing(
    "characters",
    CHARACTER_B_ID,
    characterRecord(
      "Tamsin Reed",
      "A canal scout with a bright scarf, a sharper memory, and an instinct for hidden routes.",
      "Dryly funny, protective, and happiest with a practical plan.",
      "Tamsin guides the party through Glasswake's alleys and waterways.",
    ),
    createdRecords,
  );

  await createIfMissing(
    "lorebooks",
    LOREBOOK_ID,
    {
      name: "Glasswake Harbor",
      description: "No-model showcase world notes for the Glasswake sample game.",
      category: "game",
      enabled: true,
      isGlobal: false,
      chatId: NO_MODEL_GAME_SHOWCASE_CHAT_ID,
      tags: ["showcase", "game"],
      metadata: SHOWCASE_META,
    },
    createdRecords,
  );
  await createIfMissing(
    "lorebook-entries",
    LOREBOOK_ENTRY_BELLS_ID,
    {
      lorebookId: LOREBOOK_ID,
      name: "The Thirteenth Bell",
      content:
        "Glasswake has twelve public bells and one hidden archive bell. When the hidden bell falls silent, the harbor's old gates begin waking.",
      keys: ["thirteenth bell", "silent bell", "Glasswake"],
      constant: true,
      enabled: true,
      order: 10,
      metadata: SHOWCASE_META,
    },
    createdRecords,
  );
  await createIfMissing(
    "lorebook-entries",
    LOREBOOK_ENTRY_TOKEN_ID,
    {
      lorebookId: LOREBOOK_ID,
      name: "Tide-token",
      content:
        "A tide-token is a small glass coin that warms near places where the harbor's old rituals still have force.",
      keys: ["tide-token", "token"],
      constant: true,
      enabled: true,
      order: 20,
      metadata: SHOWCASE_META,
    },
    createdRecords,
  );

  await createIfMissing<Chat>(
    "chats",
    NO_MODEL_GAME_SHOWCASE_CHAT_ID,
    {
      name: "Sample Game: Glasswake Harbor",
      mode: "game",
      characterIds: [CHARACTER_A_ID, CHARACTER_B_ID],
      groupId: "showcase-no-model-game-v1",
      personaId: PERSONA_ID,
      promptPresetId: null,
      connectionId: null,
      metadata: chatMetadata(SHOWCASE_SEED_PENDING),
    },
    createdRecords,
  );

  await seedMessages(createdRecords);
  await verifyShowcaseComplete();
  await storageApi.patchChatMetadata<Chat>(NO_MODEL_GAME_SHOWCASE_CHAT_ID, {
    showcaseSeedStatus: SHOWCASE_SEED_READY,
  });
}

export async function ensureNoModelGameShowcase(): Promise<{ chatId: string }> {
  const createdRecords: CreatedRecord[] = [];
  try {
    await seedNoModelGameShowcase(createdRecords);
  } catch (error) {
    const rollbackFailures = await rollbackCreatedRecords(createdRecords);
    if (rollbackFailures.length > 0) {
      throw new Error(
        `Showcase seed failed and rollback failed for ${rollbackFailures.join("; ")}: ${errorMessage(error)}`,
      );
    }
    throw error;
  }
  return { chatId: NO_MODEL_GAME_SHOWCASE_CHAT_ID };
}

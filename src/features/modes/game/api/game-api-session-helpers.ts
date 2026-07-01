import * as g from "./game-api-support";
import { journalFromChat } from "./game-api-journal-helpers";

export function fallbackGameBlueprint(preferences: string): Record<string, unknown> {
  const overview = preferences.trim()
    ? `A local campaign shaped around: ${preferences.trim()}`
    : "A flexible local campaign ready for play.";
  return {
    worldOverview: overview,
    hudWidgets: [
      { id: "party", type: "party", title: "Party", enabled: true },
      { id: "journal", type: "journal", title: "Journal", enabled: true },
      { id: "inventory", type: "inventory", title: "Inventory", enabled: true },
    ],
    introSequence: ["Frame the opening situation clearly.", "Invite the player to choose the first action."],
    visualTheme: { palette: "default", uiStyle: "classic", moodDefault: "neutral" },
    campaignPlan: {
      questSeeds: [],
      encounterPrinciples: ["Keep conflicts actionable.", "Let player choices alter the world state."],
    },
  };
}

export function setupNpcsFromResponse(setup: Record<string, unknown>): g.GameNpc[] {
  const raw = Array.isArray(setup.startingNpcs) ? setup.startingNpcs : [];
  return raw.map((npc, index) => {
    const record = g.asRecord(npc);
    return {
      id: g.newId("npc"),
      emoji: typeof record.emoji === "string" && record.emoji.trim() ? record.emoji.trim() : "👤",
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : `NPC ${index + 1}`,
      description: typeof record.description === "string" ? record.description : "",
      descriptionSource: "model",
      location: typeof record.location === "string" ? record.location : "",
      reputation: Number.isFinite(Number(record.reputation)) ? Number(record.reputation) : 0,
      met: true,
      notes: typeof record.role === "string" && record.role.trim() ? [`Role: ${record.role.trim()}`] : [],
      avatarUrl: null,
    } satisfies g.GameNpc;
  });
}

export function setupCharacterCards(setup: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(setup.characterCards) ? setup.characterCards.map(g.asRecord) : [];
}

export function setupBlueprint(
  setup: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const rawBlueprint = g.asRecord(setup.blueprint);
  const fallbackWidgets = Array.isArray(fallback.hudWidgets) ? fallback.hudWidgets : [];
  return {
    ...rawBlueprint,
    hudWidgets: Array.isArray(rawBlueprint.hudWidgets) ? rawBlueprint.hudWidgets : fallbackWidgets,
    introSequence: Array.isArray(rawBlueprint.introSequence) ? rawBlueprint.introSequence : fallback.introSequence,
    visualTheme:
      Object.keys(g.asRecord(rawBlueprint.visualTheme)).length > 0 ? rawBlueprint.visualTheme : fallback.visualTheme,
    campaignPlan:
      Object.keys(g.asRecord(rawBlueprint.campaignPlan)).length > 0
        ? rawBlueprint.campaignPlan
        : g.asRecord(setup.campaignPlan ?? fallback.campaignPlan),
  };
}

export function isGameSetupConfig(value: unknown): value is g.GameSetupConfig {
  const record = g.asRecord(value);
  return (
    typeof record.genre === "string" && typeof record.setting === "string" && Array.isArray(record.partyCharacterIds)
  );
}

export function gameSetupChatPatch(config: g.GameSetupConfig, connectionId?: string | null): Record<string, unknown> {
  const characterIds = libraryCharacterIds(config.partyCharacterIds ?? []);
  return {
    characterIds,
    personaId: config.personaId ?? null,
    ...(connectionId ? { connectionId } : {}),
  };
}

function libraryCharacterIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && !id.startsWith("npc:"))
    : [];
}

export function gameSetupMetadataPatch(config: g.GameSetupConfig): Record<string, unknown> {
  return {
    gameSetupConfig: config,
    gamePartyCharacterIds: config.partyCharacterIds ?? [],
    activeLorebookIds: config.activeLorebookIds ?? [],
    gameSceneConnectionId: config.sceneConnectionId ?? null,
    gameImageConnectionId: config.imageConnectionId ?? null,
    imageStyleProfileId: config.imageStyleProfileId ?? null,
    enableSpriteGeneration: Boolean(config.enableSpriteGeneration),
    gameUseMusicDj: Boolean(config.enableMusicDj),
    gameMusicProvider: config.enableMusicDj ? "youtube" : null,
    gameUseSpotifyMusic: Boolean(config.enableSpotifyDj),
    gameSpotifySourceType: config.spotifySourceType ?? null,
    gameSpotifyPlaylistId: config.spotifyPlaylistId ?? null,
    gameSpotifyPlaylistName: config.spotifyPlaylistName ?? null,
    gameSpotifyArtist: config.spotifyArtist ?? null,
    gameLorebookKeeperEnabled: Boolean(config.enableLorebookKeeper),
    gameGenerationParameters: config.generationParameters ?? null,
    gameLanguage: config.language ?? null,
    gameRating: config.rating ?? "sfw",
  };
}

export function effectiveSetupConfigFromMeta(
  config: g.GameSetupConfig | undefined,
  meta: Record<string, unknown>,
): g.GameSetupConfig | undefined {
  if (!config || !Array.isArray(meta.gamePartyCharacterIds)) return config;
  return {
    ...config,
    partyCharacterIds: g.stringArray(meta.gamePartyCharacterIds),
  };
}

export function sessionSummary(sessionNumber: number, chat: g.Chat, meta: Record<string, unknown>): g.SessionSummary {
  const journal = journalFromChat(chat, meta, { includeCurrentLocation: true });
  const npcs = Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as g.GameNpc[]) : [];
  const map = (meta.gameMap as g.GameMap | null) ?? null;
  return {
    ...g.buildDeterministicSummary(journal, sessionNumber, npcs, map),
    nextSessionRequest: null,
    timestamp: g.nowIso(),
  } as g.SessionSummary;
}

export function normalizeSessionSummaryPayload(
  raw: unknown,
  fallback: g.SessionSummary,
  nextSessionRequest?: string | null,
): g.SessionSummary {
  const record = g.asRecord(raw);
  const factLists = g.dedupeSessionSummaryLists({
    keyDiscoveries: normalizeSessionSummaryTextList(record.keyDiscoveries, fallback.keyDiscoveries),
    legacyRevelations: normalizeSessionSummaryTextList(record.revelations, []),
    characterMoments: normalizeSessionSummaryTextList(record.characterMoments, fallback.characterMoments),
    littleDetails: normalizeSessionSummaryTextList(record.littleDetails, fallback.littleDetails),
    npcUpdates: normalizeSessionSummaryTextList(record.npcUpdates, fallback.npcUpdates),
  });
  return {
    sessionNumber: Number.isFinite(Number(record.sessionNumber))
      ? Number(record.sessionNumber)
      : fallback.sessionNumber,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary : fallback.summary,
    resumePoint:
      typeof record.resumePoint === "string" && record.resumePoint.trim() ? record.resumePoint : fallback.resumePoint,
    partyDynamics:
      typeof record.partyDynamics === "string" && record.partyDynamics.trim()
        ? record.partyDynamics
        : fallback.partyDynamics,
    partyState:
      typeof record.partyState === "string" && record.partyState.trim() ? record.partyState : fallback.partyState,
    keyDiscoveries: factLists.keyDiscoveries,
    characterMoments: factLists.characterMoments,
    littleDetails: factLists.littleDetails,
    statsSnapshot:
      Object.keys(g.asRecord(record.statsSnapshot)).length > 0
        ? g.asRecord(record.statsSnapshot)
        : fallback.statsSnapshot,
    npcUpdates: factLists.npcUpdates,
    nextSessionRequest:
      nextSessionRequest ??
      (typeof record.nextSessionRequest === "string"
        ? record.nextSessionRequest
        : (fallback.nextSessionRequest ?? null)),
    timestamp: typeof record.timestamp === "string" ? record.timestamp : g.nowIso(),
  };
}

function normalizeSessionSummaryTextList(raw: unknown, fallback: string[]): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : fallback;
}

export function gameSessionSortValue(chat: g.Chat): number {
  const meta = g.chatMeta(chat);
  const value = Number(meta.gameSessionNumber ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function nextGameSessionNumber(chats: g.Chat[]): number {
  return Math.max(0, ...chats.map(gameSessionSortValue)) + 1;
}

export function gameCarryoverPatch(meta: Record<string, unknown>) {
  const keys = [
    "gameSetupConfig",
    "gamePartyCharacterIds",
    "gameWorldOverview",
    "gameBlueprint",
    "gameCampaignProgression",
    "gameMap",
    "gameMaps",
    "activeGameMapId",
    "gameNpcs",
    "gameCharacterCards",
    "gamePartyArcs",
    "gameArtStylePrompt",
    "enableSpriteGeneration",
    "gameSceneConnectionId",
    "gameImageConnectionId",
    "activeLorebookIds",
    "gameUseMusicDj",
    "gameMusicProvider",
    "gameUseSpotifyMusic",
    "gameSpotifySourceType",
    "gameSpotifyPlaylistId",
    "gameSpotifyPlaylistName",
    "gameSpotifyArtist",
    "gameGenerationParameters",
    "gameLanguage",
    "gameRating",
    "gameInventory",
    "gameWidgetState",
    "gameTime",
    "gameTimeFormatted",
    "gameWeather",
    "gameMorale",
    "gameMoraleTier",
    "gamePlayerNotes",
    "gameJournal",
    "gameLorebookKeeperEnabled",
    "gameLorebookKeeperLorebookId",
    "discordWebhookUrl",
  ];
  return Object.fromEntries(keys.filter((key) => key in meta).map((key) => [key, meta[key]]));
}

function nonEmptyRecord(value: unknown): Record<string, unknown> | null {
  const record = g.asRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function campaignProgressionStringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => g.readTrimmed(item)).filter(Boolean) : fallback;
}

function campaignProgressionRecordList(value: unknown, fallback: unknown[]): unknown[] {
  return Array.isArray(value)
    ? value.map((item) => g.asRecord(item)).filter((item) => Object.keys(item).length > 0)
    : fallback;
}

export function normalizeCampaignProgression(
  raw: unknown,
  fallback: unknown = {},
): g.UpdateCampaignProgressionResponse["campaignProgression"] {
  const record = g.asRecord(raw);
  const fallbackRecord = g.asRecord(fallback);
  const fallbackProgression: g.UpdateCampaignProgressionResponse["campaignProgression"] = {
    storyArc: g.readTrimmed(fallbackRecord.storyArc) || null,
    plotTwists: campaignProgressionStringList(fallbackRecord.plotTwists, []),
    partyArcs: campaignProgressionRecordList(fallbackRecord.partyArcs, []),
  };
  return {
    storyArc: Object.prototype.hasOwnProperty.call(record, "storyArc")
      ? g.readTrimmed(record.storyArc) || null
      : fallbackProgression.storyArc,
    plotTwists: Object.prototype.hasOwnProperty.call(record, "plotTwists")
      ? campaignProgressionStringList(record.plotTwists, fallbackProgression.plotTwists)
      : fallbackProgression.plotTwists,
    partyArcs: Object.prototype.hasOwnProperty.call(record, "partyArcs")
      ? campaignProgressionRecordList(record.partyArcs, fallbackProgression.partyArcs)
      : fallbackProgression.partyArcs,
  };
}

export function normalizeSessionConclusionGenerated(
  raw: unknown,
  fallback: {
    summary: g.SessionSummary;
    campaignProgression: unknown;
    characterCards: unknown[];
  },
  nextSessionRequest?: string | null,
): { summary: g.SessionSummary; campaignProgression: unknown; characterCards: unknown[] } {
  const record = g.asRecord(raw);
  const repairedCampaignProgression = nonEmptyRecord(record.campaignProgression);
  return {
    summary: normalizeSessionSummaryPayload(g.asRecord(record.summary), fallback.summary, nextSessionRequest ?? null),
    campaignProgression: repairedCampaignProgression
      ? normalizeCampaignProgression(repairedCampaignProgression, fallback.campaignProgression)
      : fallback.campaignProgression,
    characterCards: Array.isArray(record.characterCards) ? record.characterCards : fallback.characterCards,
  };
}

export function gameStateCarryoverPatch(
  previousChat: g.Chat | null | undefined,
  nextChatId: string,
): Record<string, unknown> {
  const previousGameState = g.asRecord((previousChat as { gameState?: unknown } | null | undefined)?.gameState);
  if (Object.keys(previousGameState).length === 0) return {};
  return {
    gameState: {
      ...previousGameState,
      id: "",
      chatId: nextChatId,
      messageId: "",
      createdAt: g.nowIso(),
    },
  };
}

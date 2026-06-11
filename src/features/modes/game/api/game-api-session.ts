import * as g from "./game-api-support";
import { createAutomaticGameCheckpoint } from "./game-api-checkpoint-helpers";
import { journalFromChat, journalFromMeta } from "./game-api-journal-helpers";
import { setupMapFromResponse } from "./game-api-map-helpers";
import {
  fallbackGameBlueprint,
  effectiveSetupConfigFromMeta,
  gameCarryoverPatch,
  gameSessionSortValue,
  gameSetupChatPatch,
  gameSetupMetadataPatch,
  gameStateCarryoverPatch,
  isGameSetupConfig,
  nextGameSessionNumber,
  normalizeCampaignProgression,
  normalizeSessionConclusionGenerated,
  normalizeSessionSummaryPayload,
  sessionSummary,
  setupBlueprint,
  setupCharacterCards,
  setupNpcsFromResponse,
} from "./game-api-session-helpers";
import { gameLorebookKeeperEnabled, runGameLorebookKeeperAfterConclusion } from "./game-api-lorebook-keeper";

export async function createGame(data: {
  name: string;
  setupConfig: g.GameSetupConfig;
  connectionId?: string;
  characterConnectionId?: string;
  promptPresetId?: string;
  chatId?: string;
  folderId?: string | null;
  partyCharacterIds?: string[];
}): Promise<g.CreateGameResponse> {
  const gameId = g.newId("game");
  const setupConfig = data.partyCharacterIds
    ? { ...data.setupConfig, partyCharacterIds: data.partyCharacterIds }
    : data.setupConfig;
  if (data.chatId) {
    await g.patchChat(data.chatId, {
      ...gameSetupChatPatch(setupConfig, data.connectionId ?? null),
      groupId: gameId,
    });
    const sessionChat = await g.patchChatMetadata(data.chatId, {
      gameId,
      gameSessionNumber: 1,
      gameSessionStatus: "setup",
      ...gameSetupMetadataPatch(setupConfig),
      gameJournal: g.createJournal(),
    });
    return { sessionChat, gameId };
  }
  const chatPatch = gameSetupChatPatch(setupConfig, data.connectionId ?? null);
  const sessionChat = await g.createChatRecord({
    name: data.name || "New Game",
    mode: "game",
    groupId: gameId,
    characterIds: g.stringArray(chatPatch.characterIds),
    personaId: setupConfig.personaId ?? null,
    folderId: data.folderId ?? null,
    connectionId: data.connectionId ?? null,
    metadata: {
      gameId,
      gameSessionNumber: 1,
      gameSessionStatus: "setup",
      ...gameSetupMetadataPatch(setupConfig),
      gameJournal: g.createJournal(),
    },
  });
  return { sessionChat, gameId };
}

export async function setupGame(data: {
  chatId: string;
  connectionId?: string;
  preferences: string;
  setupConfig?: g.GameSetupConfig;
  setup?: Record<string, unknown>;
}): Promise<g.SetupResponse> {
  const existingChat = await g.getChat(data.chatId);
  const existingMeta = g.chatMeta(existingChat);
  const fallback = fallbackGameBlueprint(data.preferences);
  const baseSetupConfig =
    data.setupConfig ?? (isGameSetupConfig(existingMeta.gameSetupConfig) ? existingMeta.gameSetupConfig : undefined);
  const setupConfig = effectiveSetupConfigFromMeta(baseSetupConfig, existingMeta);
  const setup =
    data.setup ??
    (await g.llmJson({
      connectionId: data.connectionId,
      fallback,
      system: g.buildSetupPrompt({
        rating: setupConfig?.rating ?? "sfw",
        enableCustomWidgets: setupConfig?.enableCustomWidgets !== false,
        language: setupConfig?.language,
      }),
      user: [
        `Player preferences:`,
        data.preferences,
        ``,
        setupConfig
          ? `Structured setup config:\n${JSON.stringify(
              {
                genre: setupConfig.genre,
                setting: setupConfig.setting,
                tone: setupConfig.tone,
                difficulty: setupConfig.difficulty,
                playerGoals: setupConfig.playerGoals,
              },
              null,
              2,
            )}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      parameters: { temperature: 0.8, maxTokens: 8192 },
      repair: {
        kind: "game_setup",
        title: "Repair Game Setup JSON",
        applyBody: {
          chatId: data.chatId,
          connectionId: data.connectionId,
          preferences: data.preferences,
          setupConfig,
        },
      },
    }));
  const worldOverview =
    typeof setup.worldOverview === "string"
      ? setup.worldOverview
      : typeof setup.overview === "string"
        ? setup.overview
        : (fallback.worldOverview as string);
  const map = setupMapFromResponse(setup);
  const blueprint = setupBlueprint(setup, fallback);
  const startingNpcs = setupNpcsFromResponse(setup);
  const characterCards = setupCharacterCards(setup);
  const campaignProgression = normalizeCampaignProgression({
    storyArc: typeof setup.storyArc === "string" ? setup.storyArc : null,
    plotTwists: Array.isArray(setup.plotTwists)
      ? setup.plotTwists.filter((item): item is string => typeof item === "string")
      : [],
    partyArcs: Array.isArray(setup.partyArcs) ? setup.partyArcs : [],
  });
  if (setupConfig) {
    await g.patchChat(
      data.chatId,
      gameSetupChatPatch(setupConfig, data.connectionId ?? existingChat.connectionId ?? null),
    );
  }
  const sessionChat = await g.patchChatMetadata(data.chatId, {
    ...(setupConfig ? gameSetupMetadataPatch(setupConfig) : { gameSetupPreferences: data.preferences ?? null }),
    gameSessionStatus: "ready",
    gameWorldOverview: worldOverview,
    gameBlueprint: blueprint,
    gameCampaignProgression: campaignProgression,
    gameMap: map,
    gameMaps: [map],
    activeGameMapId: map.id ?? null,
    gameNpcs: startingNpcs,
    gameCharacterCards: characterCards,
    gamePartyArcs: campaignProgression.partyArcs,
    gameArtStylePrompt:
      typeof setup.artStylePrompt === "string" ? setup.artStylePrompt : (setupConfig?.artStylePrompt ?? null),
    gameTime: g.createInitialTime(),
    gameJournal: g.createJournal(),
  });
  return { setup, worldOverview, sessionChat };
}

export async function startGame(data: { chatId: string }): Promise<g.StartGameResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const sessionStatus = typeof meta.gameSessionStatus === "string" ? meta.gameSessionStatus : "ready";
  const recentMessages = await g.listMessages(data.chatId, 40).catch(() => []);
  const hasExistingGmTurn = recentMessages.some((message) => {
    if (message.role !== "assistant") return false;
    if (typeof message.content !== "string" || !message.content.trim()) return false;
    return g.asRecord(message.extra).hiddenFromAi !== true;
  });
  if (sessionStatus === "active" && hasExistingGmTurn) {
    return { status: "active", alreadyStarted: true, sessionChat: chat };
  }
  if (sessionStatus !== "ready" && sessionStatus !== "active") {
    throw new Error(`Cannot start game: status is "${sessionStatus}", expected "ready"`);
  }
  if (hasExistingGmTurn) {
    const sessionChat = await g.patchChatMetadata(data.chatId, { gameSessionStatus: "active" });
    return { status: "active", alreadyStarted: true, sessionChat };
  }
  const sessionChat = await g.patchChatMetadata(data.chatId, {
    gameSessionStatus: "active",
    gameActiveState: "exploration",
  });
  const checkpointWarning = await createAutomaticGameCheckpoint({
    chatId: data.chatId,
    label: "Session started",
    triggerType: "session_start",
  });
  return {
    status: "active",
    alreadyStarted: false,
    sessionChat,
    ...(checkpointWarning ? { checkpointWarning } : {}),
  };
}

export async function startSession(data: { gameId: string; connectionId?: string }): Promise<g.StartSessionResponse> {
  const chats = await g.storageApi.list<g.Chat>("chats");
  const existing = chats
    .filter((chat) => g.chatMeta(chat).gameId === data.gameId)
    .sort((a, b) => gameSessionSortValue(a) - gameSessionSortValue(b));
  const sessionNumber = nextGameSessionNumber(existing);
  const previousChat = existing[existing.length - 1] ?? null;
  const previousMeta = g.chatMeta(previousChat);
  const summaries = Array.isArray(previousMeta.gamePreviousSessionSummaries)
    ? [...(previousMeta.gamePreviousSessionSummaries as g.SessionSummary[])].sort(
        (a, b) => a.sessionNumber - b.sessionNumber,
      )
    : [];
  const latestEndingBeat = (await g.sessionTranscript(existing[existing.length - 1]?.id ?? "", 8).catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .slice(-2)
    .join("\n");
  let recap = summaries.length ? g.buildSessionCarryoverContext(summaries) : "";
  if (summaries.length && data.connectionId) {
    try {
      recap = await g.llmApi.complete({
        connectionId: data.connectionId,
        messages: [
          { role: "system", content: "Write only the requested game-session recap narration. Do not return JSON." },
          { role: "user", content: g.buildRecapPrompt(summaries, latestEndingBeat) },
        ],
        parameters: { temperature: 0.7, maxTokens: 1200 },
      });
    } catch {
      recap = g.buildSessionCarryoverContext(summaries);
    }
  }
  const sessionChatId = g.newId("chat");
  const sessionChat = await g.createChatRecord({
    id: sessionChatId,
    name: `Game Session ${sessionNumber}`,
    mode: "game",
    groupId: data.gameId,
    characterIds: Array.isArray(previousChat?.characterIds) ? previousChat.characterIds : [],
    personaId: previousChat?.personaId ?? null,
    folderId: previousChat?.folderId ?? null,
    connectionId: data.connectionId ?? previousChat?.connectionId ?? null,
    ...gameStateCarryoverPatch(previousChat, sessionChatId),
    metadata: {
      ...gameCarryoverPatch(previousMeta),
      gameId: data.gameId,
      gameSessionNumber: sessionNumber,
      gameSessionStatus: "active",
      gameActiveState: "exploration",
      gamePreviousSessionSummaries: summaries,
      gameSessionCarryover: g.buildSessionCarryoverContext(summaries),
      gameJournal: journalFromMeta(previousMeta),
    },
  });
  if (recap.trim()) {
    await g.createChatMessage(sessionChat.id, {
      role: "system",
      characterId: null,
      content: `[session-recap]\n${recap.trim()}`,
      extra: { hiddenFromAi: false, isSessionRecap: true },
    });
    g.mirrorGameMessageToDiscord(g.chatMeta(sessionChat), recap.trim(), "Narrator");
  }
  const checkpointWarning = await createAutomaticGameCheckpoint({
    chatId: sessionChat.id,
    label: "Session started",
    triggerType: "session_start",
  });
  return { sessionChat, sessionNumber, recap, ...(checkpointWarning ? { checkpointWarning } : {}) };
}

export async function concludeSession(data: {
  chatId: string;
  connectionId?: string;
  nextSessionRequest?: string;
  summary?: g.SessionSummary;
  generated?: Record<string, unknown>;
}): Promise<g.SessionSummaryResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const sessionNumber = Number(meta.gameSessionNumber ?? 1);
  const fallback = sessionSummary(sessionNumber, chat, meta);
  let summary = normalizeSessionSummaryPayload(data.summary, fallback, data.nextSessionRequest ?? null);
  let campaignProgression = meta.gameCampaignProgression;
  let characterCards = Array.isArray(meta.gameCharacterCards) ? meta.gameCharacterCards : [];
  if (!data.summary && data.generated) {
    const normalized = normalizeSessionConclusionGenerated(
      data.generated,
      { summary: fallback, campaignProgression, characterCards },
      data.nextSessionRequest ?? null,
    );
    summary = normalized.summary;
    campaignProgression = normalized.campaignProgression;
    characterCards = normalized.characterCards;
  } else if (!data.summary && data.connectionId) {
    const transcript = await g.sessionTranscript(data.chatId, 160);
    const generated = await g.llmJson({
      connectionId: data.connectionId,
      fallback: { summary, campaignProgression, characterCards },
      system: g.buildSessionConclusionPrompt({
        language:
          typeof g.asRecord(meta.gameSetupConfig).language === "string"
            ? (g.asRecord(meta.gameSetupConfig).language as string)
            : null,
        includeCharacterCards: characterCards.length > 0,
      }),
      user: [
        `Current campaign progression:`,
        JSON.stringify(campaignProgression ?? {}, null, 2),
        ``,
        `Current character cards:`,
        JSON.stringify(characterCards, null, 2),
        ``,
        `Session transcript:`,
        transcript,
      ].join("\n"),
      parameters: { temperature: 0.35, maxTokens: 5000 },
      repair: {
        kind: "session_conclusion",
        title: `Repair Session ${sessionNumber} Conclusion JSON`,
        applyBody: {
          chatId: data.chatId,
          connectionId: data.connectionId,
          nextSessionRequest: data.nextSessionRequest,
        },
      },
    });
    const normalized = normalizeSessionConclusionGenerated(
      generated,
      { summary: fallback, campaignProgression, characterCards },
      data.nextSessionRequest ?? null,
    );
    summary = normalized.summary;
    campaignProgression = normalized.campaignProgression;
    characterCards = normalized.characterCards;
  }
  const summaries = Array.isArray(meta.gamePreviousSessionSummaries)
    ? [...(meta.gamePreviousSessionSummaries as g.SessionSummary[])]
    : [];
  const nextSummaries = summaries.filter((item) => item.sessionNumber !== sessionNumber).concat(summary);
  let sessionChat = await g.patchChatMetadata(data.chatId, {
    gameSessionStatus: "concluded",
    gameJournal: journalFromChat(chat, meta, { includeCurrentLocation: false }),
    gamePreviousSessionSummaries: nextSummaries,
    gameCampaignProgression: campaignProgression,
    gameCharacterCards: characterCards,
    ...(gameLorebookKeeperEnabled(meta) ? { gameLorebookKeeperEnabled: true } : {}),
  });
  const checkpointWarning = await createAutomaticGameCheckpoint({
    chatId: data.chatId,
    label: "Session ended",
    triggerType: "session_end",
  });
  if (gameLorebookKeeperEnabled(meta)) {
    const keeperRun = await runGameLorebookKeeperAfterConclusion({
      chat: sessionChat,
      meta: { ...meta, ...g.chatMeta(sessionChat), gameLorebookKeeperEnabled: true },
      sessionNumber,
      summary,
      connectionId: data.connectionId,
    });
    sessionChat = keeperRun.sessionChat;
  }
  return { summary, sessionChat, ...(checkpointWarning ? { checkpointWarning } : {}) };
}

export async function updateCampaignProgression(data: {
  chatId: string;
  sessionNumber: number;
  connectionId?: string;
  generated?: Record<string, unknown>;
}): Promise<g.UpdateCampaignProgressionResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const transcript = await g.sessionTranscript(data.chatId);
  const fallback = {
    storyArc: transcript.trim() ? `Session ${data.sessionNumber} advanced the campaign.` : null,
    plotTwists: [],
    partyArcs: [],
  };
  const generated =
    data.generated ??
    (await g.llmJson({
      connectionId: data.connectionId,
      fallback,
      system:
        "Update campaign progression from this game session. Return strict JSON with storyArc, plotTwists, and partyArcs.",
      user: transcript,
      parameters: { temperature: 0.4, maxTokens: 1800 },
      repair: {
        kind: "campaign_progression",
        title: `Repair Session ${data.sessionNumber} Plot JSON`,
        applyBody: {
          chatId: data.chatId,
          sessionNumber: data.sessionNumber,
          connectionId: data.connectionId,
        },
      },
    }));
  const campaignProgression = normalizeCampaignProgression(generated, fallback);
  const sessionChat = await g.patchChatMetadata(data.chatId, {
    gameCampaignProgression: campaignProgression,
    gameCampaignProgressionUpdatedAt: g.nowIso(),
  });
  return { sessionChat, gameId: String(meta.gameId ?? ""), campaignProgression };
}

export async function gameSessions(gameId: string): Promise<g.Chat[]> {
  const chats = await g.storageApi.list<g.Chat>("chats");
  return chats.filter((chat) => g.chatMeta(chat).gameId === gameId);
}

import * as g from "./game-api-support";
import { parseReputationTags, stripReputationTags } from "../lib/game-tag-parser";
import {
  buildGameCard,
  currentPartyNames,
  gameCardByName,
  gameCardName,
  gameCardPromptText,
  normalizeGeneratedPartyCard,
  normalizedName,
  partyCardNameMatches,
  partyCardCurrentState,
  partySpriteSubjects,
  targetPartyCardPromptContext,
} from "./game-api-party-helpers";

function uniquePartyIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function chatCharacterIdsFromPartyIds(ids: string[]): string[] {
  return ids.filter((id) => !id.startsWith("npc:"));
}

function gameSetupConfigWithParty(meta: Record<string, unknown>, partyIds: string[]): Record<string, unknown> | null {
  const setupConfig = g.asRecord(meta.gameSetupConfig);
  return Object.keys(setupConfig).length > 0 ? { ...setupConfig, partyCharacterIds: partyIds } : null;
}

async function patchPartyState(
  chatId: string,
  meta: Record<string, unknown>,
  partyIds: string[],
  metadataPatch: Record<string, unknown>,
): Promise<g.Chat> {
  const nextPartyIds = uniquePartyIds(partyIds);
  await g.patchChat(chatId, { characterIds: chatCharacterIdsFromPartyIds(nextPartyIds) });
  const setupConfig = gameSetupConfigWithParty(meta, nextPartyIds);
  return g.patchChatMetadata(chatId, {
    ...metadataPatch,
    gamePartyCharacterIds: nextPartyIds,
    ...(setupConfig ? { gameSetupConfig: setupConfig } : {}),
  });
}

async function partyIdsMatchingName(
  ids: string[],
  characterName: string,
  meta: Record<string, unknown>,
): Promise<Set<string>> {
  const targetName = normalizedName(characterName);
  const matches = new Set<string>();
  const npcs = Array.isArray(meta.gameNpcs) ? meta.gameNpcs.map(g.asRecord) : [];
  const characterIds = ids.filter((id) => !id.startsWith("npc:"));
  const characterRows = await Promise.all(
    characterIds.map((id) => g.storageApi.get<Record<string, unknown>>("characters", id).catch(() => null)),
  );
  for (let index = 0; index < characterIds.length; index += 1) {
    const row = characterRows[index];
    if (row && normalizedName(g.recordName(row)) === targetName) matches.add(characterIds[index]!);
  }
  for (const id of ids.filter((item) => item.startsWith("npc:"))) {
    const npc = npcs.find((row) => id === g.readTrimmed(row.id) || id === `npc:${g.readTrimmed(row.id)}`);
    if (npc && normalizedName(g.readTrimmed(npc.name)) === targetName) matches.add(id);
  }
  return matches;
}

export async function upsertPartyCard(data: {
  chatId: string;
  characterName: string;
  characterId?: string;
  connectionId?: string;
  added?: boolean;
  generated?: Record<string, unknown>;
}): Promise<g.PartyCardResponse> {
  const characterName = data.characterName.trim();
  if (!characterName) {
    throw new Error("Party card generation requires a character name.");
  }
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const cards = Array.isArray(meta.gameCharacterCards) ? [...meta.gameCharacterCards] : [];
  const existingTargetCard = gameCardByName(cards, characterName);
  const fallback = existingTargetCard ?? buildGameCard(characterName);
  const generated =
    data.generated ??
    (await g.llmJson({
      connectionId: data.connectionId,
      fallback,
      system: "Create one De-Koi Game mode party character card. Return valid JSON only.",
      user: g.buildPartyRecruitCardPrompt({
        targetCharacterName: characterName,
        targetCharacterCard: await targetPartyCardPromptContext(chat, meta, characterName, data.characterId),
        currentPartyNames: currentPartyNames(cards).filter(
          (name) => normalizedName(name) !== normalizedName(characterName),
        ),
        currentPartyCards: cards.length ? JSON.stringify(cards, null, 2) : null,
        existingTargetCard: existingTargetCard ? JSON.stringify(existingTargetCard, null, 2) : null,
        worldOverview: g.readTrimmed(meta.gameWorldOverview),
        storyArc: g.readTrimmed(meta.gameStoryArc),
        plotTwists: Array.isArray(meta.gamePlotTwists) ? meta.gamePlotTwists.map(String).filter(Boolean) : null,
        currentState: partyCardCurrentState(chat, meta),
        recentTranscript: await g.sessionTranscript(data.chatId, 40),
        language: g.readTrimmed(meta.gameLanguage),
        purpose: existingTargetCard && !data.added ? "regenerate" : "recruit",
      }),
      parameters: { temperature: 0.45, maxTokens: 1400 },
      repair: {
        kind: "party_card",
        title: `Repair ${characterName} Party Card JSON`,
        applyBody: {
          chatId: data.chatId,
          characterName,
          characterId: data.characterId,
          connectionId: data.connectionId,
          added: data.added,
        },
      },
    }));
  const card = normalizeGeneratedPartyCard(generated, fallback, characterName);
  const targetName = normalizedName(characterName);
  const nextCards = cards
    .filter((item) => normalizedName(g.readTrimmed(g.asRecord(item).name)) !== targetName)
    .concat(card);
  const partyId = g.readTrimmed(data.characterId);
  const currentPartyIds = uniquePartyIds(g.stringArray(meta.gamePartyCharacterIds));
  const sessionChat =
    data.added && partyId
      ? await patchPartyState(data.chatId, meta, [...currentPartyIds, partyId], { gameCharacterCards: nextCards })
      : await g.patchChatMetadata(data.chatId, { gameCharacterCards: nextCards });
  return {
    sessionChat,
    added: data.added,
    characterName,
    cardCreated: true,
    gameCard: card,
  };
}

export async function removePartyMember(data: { chatId: string; characterName: string }): Promise<g.PartyCardResponse> {
  const chat = await g.getChat(data.chatId);
  const meta = g.chatMeta(chat);
  const cards = Array.isArray(meta.gameCharacterCards) ? [...meta.gameCharacterCards] : [];
  const characterName = data.characterName.trim();
  if (!characterName) {
    throw new Error("Party card removal requires a character name.");
  }
  const targetName = normalizedName(characterName);
  const nextCards = cards.filter((item) => !partyCardNameMatches(item, targetName));
  const currentPartyIds = uniquePartyIds(g.stringArray(meta.gamePartyCharacterIds));
  const removedIds = await partyIdsMatchingName(currentPartyIds, characterName, meta);
  const sessionChat =
    removedIds.size > 0
      ? await patchPartyState(
          data.chatId,
          meta,
          currentPartyIds.filter((id) => !removedIds.has(id)),
          { gameCharacterCards: nextCards },
        )
      : await g.patchChatMetadata(data.chatId, { gameCharacterCards: nextCards });
  return { sessionChat, removed: nextCards.length !== cards.length, characterName };
}

export async function partyTurn(input: {
  chatId: string;
  narration: string;
  playerAction?: string;
  connectionId?: string | null;
  debugMode?: boolean;
}) {
  const chat = await g.getChat(input.chatId);
  const meta = g.chatMeta(chat);
  const cards = Array.isArray(meta.gameCharacterCards) ? meta.gameCharacterCards.map(g.asRecord) : [];
  const partyIds = g.stringArray(meta.gamePartyCharacterIds);
  const characterSprites = await g.loadCharacterSprites(
    g.visualAssetsApi,
    await partySpriteSubjects(partyIds.length > 0 ? partyIds : g.stringArray(chat?.characterIds), cards),
  );
  const names = cards.map((card, index) => gameCardName(card, `Party member ${index + 1}`));
  const partyNames = names.length ? names.join(", ") : "The party";
  const connectionId = input.connectionId?.trim();
  if (!connectionId) {
    throw new Error("Choose a chat connection before asking the party.");
  }
  const raw = await g.llmApi.complete({
    connectionId,
    messages: [
      {
        role: "system",
        content: g.buildPartySystemPrompt({
          partyCards: cards.length
            ? cards.map((card, index) => ({
                name: gameCardName(card, `Party member ${index + 1}`),
                card: gameCardPromptText(card),
              }))
            : [{ name: partyNames, card: partyNames }],
          playerName:
            typeof meta.gamePlayerName === "string" && meta.gamePlayerName.trim() ? meta.gamePlayerName : "Player",
          gameActiveState: typeof meta.gameActiveState === "string" ? meta.gameActiveState : "exploration",
          partyArcs: Array.isArray(meta.gamePartyArcs) ? (meta.gamePartyArcs as g.PartyArc[]) : [],
          characterSprites,
        }),
      },
      {
        role: "user",
        content: `GM narration:\n${input.narration}\n\nPlayer action:\n${input.playerAction ?? ""}\n\nWrite the party's immediate reactions.`,
      },
    ],
    parameters: { temperature: 0.9, maxTokens: 1200 },
  });
  const withoutPartyMarkers = raw.replace(/\[(?:party-turn|party-chat)\]/gi, "").trim();
  const reputationActions = parseReputationTags(withoutPartyMarkers);
  const clean = stripReputationTags(withoutPartyMarkers).trim();
  if (!clean || g.parsePartyDialogue(clean).length === 0) {
    throw new Error("The party response was empty or malformed.");
  }
  const reputationResult =
    reputationActions.length > 0
      ? g.processReputationActions(
          Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as g.GameNpc[]) : [],
          reputationActions.map((action) => ({ npcId: action.npcName, action: action.action })),
        )
      : null;
  const message = await g.createChatMessage(input.chatId, {
    role: "assistant",
    characterId: null,
    content: `[party-turn]\n${clean}`,
    extra: {},
    swipes: [{ content: `[party-turn]\n${clean}` }],
    activeSwipeIndex: 0,
  });
  let reputationNpcs: g.GameNpc[] | null = null;
  if (reputationResult && reputationResult.changes.length > 0) {
    try {
      await g.patchChatMetadata(input.chatId, { gameNpcs: reputationResult.npcs });
      reputationNpcs = reputationResult.npcs;
    } catch (error) {
      const messageId = typeof message.id === "string" ? message.id.trim() : "";
      if (!messageId) throw error;
      try {
        await g.storageApi.delete("messages", messageId);
      } catch (cleanupError) {
        const updateMessage = error instanceof Error ? error.message : String(error);
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(
          `Party-turn reputation update failed: ${updateMessage}; message cleanup failed: ${cleanupMessage}`,
        );
      }
      throw error;
    }
  }
  g.mirrorGameMessageToDiscord(meta, clean, "Party");
  return {
    raw: clean,
    messageId: typeof message.id === "string" ? message.id : null,
    ...(reputationNpcs ? { npcs: reputationNpcs } : {}),
  };
}

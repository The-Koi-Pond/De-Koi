import type { SetupJourneyIntent, SetupJourneyMode } from "../../../../engine/onboarding";

export interface SetupLaunchRequest {
  intent: SetupJourneyIntent | null;
  ready: boolean;
  usableConnectionIds: string[];
}

export interface ClaimedSetupLaunch {
  token: number;
  journeyId: string;
  mode: SetupJourneyMode;
  originCharacterId: string | null;
  connectionId: string;
}

interface CreatedChat {
  id: string;
}

export interface CharacterLaunchContext {
  characterName: string;
  firstMessage?: string;
  alternateGreetings?: string[];
}

interface SetupChatLaunchDependencies<TChat extends CreatedChat> {
  createChat: (input: {
    name: string;
    mode: SetupJourneyMode;
    characterIds: string[];
    connectionId: string;
  }) => Promise<TChat>;
  applyStarredPreset: (input: { mode: SetupJourneyMode; chatId: string }) => Promise<unknown>;
  resolveCharacterLaunchContext?: (characterId: string) => Promise<CharacterLaunchContext | null>;
  initializeCharacterChat?: (
    chatId: string,
    characterId: string,
    context: CharacterLaunchContext,
    claim: ClaimedSetupLaunch,
  ) => Promise<unknown>;
  complete: (chat: TChat, claim: ClaimedSetupLaunch) => void | Promise<void>;
}

function modeLabel(mode: SetupJourneyMode): string {
  if (mode === "conversation") return "Conversation";
  if (mode === "roleplay") return "Roleplay";
  return "Game";
}

export function createSetupChatLaunchOrchestrator<TChat extends CreatedChat>(
  dependencies: SetupChatLaunchDependencies<TChat>,
) {
  let nextToken = 0;
  const claimedJourneyIds = new Set<string>();
  const completedJourneyIds = new Set<string>();
  let activeFlight: { journeyIds: Set<string>; promise: Promise<TChat> } | null = null;

  const claimSetupLaunch = (request: SetupLaunchRequest): ClaimedSetupLaunch | null => {
    const { intent, ready, usableConnectionIds } = request;
    if (!intent || !ready || intent.dismissed || intent.completed) return null;
    if (claimedJourneyIds.has(intent.journeyId) || completedJourneyIds.has(intent.journeyId)) return null;
    const connectionId =
      (intent.selectedConnectionId && usableConnectionIds.includes(intent.selectedConnectionId)
        ? intent.selectedConnectionId
        : usableConnectionIds[0]) ?? null;
    if (!connectionId) return null;

    const claim = {
      token: ++nextToken,
      journeyId: intent.journeyId,
      mode: intent.mode,
      originCharacterId: intent.originCharacterId,
      connectionId,
    };
    claimedJourneyIds.add(intent.journeyId);
    return claim;
  };

  const launch = async (request: SetupLaunchRequest): Promise<TChat | null> => {
    if (activeFlight && request.intent && request.ready && !request.intent.dismissed && !request.intent.completed) {
      activeFlight.journeyIds.add(request.intent.journeyId);
      claimedJourneyIds.add(request.intent.journeyId);
      return activeFlight.promise;
    }
    const claim = claimSetupLaunch(request);
    if (!claim) return null;
    const journeyIds = new Set([claim.journeyId]);
    const promise = (async () => {
      const characterContext = claim.originCharacterId && dependencies.resolveCharacterLaunchContext
        ? await dependencies.resolveCharacterLaunchContext(claim.originCharacterId)
        : null;
      const chat = await dependencies.createChat({
        name: characterContext?.characterName
          ? `${characterContext.characterName} - ${modeLabel(claim.mode)}`
          : `New ${modeLabel(claim.mode)}`,
        mode: claim.mode,
        characterIds: claim.originCharacterId ? [claim.originCharacterId] : [],
        connectionId: claim.connectionId,
      });
      try {
        await dependencies.applyStarredPreset({ mode: claim.mode, chatId: chat.id });
      } catch {
        // Preset application is optional; the successfully created chat remains usable.
      }
      if (claim.originCharacterId && characterContext && dependencies.initializeCharacterChat) {
        try {
          await dependencies.initializeCharacterChat(chat.id, claim.originCharacterId, characterContext, claim);
        } catch {
          // Greeting setup is optional; the successfully created chat must still be finalized.
        }
      }
      await dependencies.complete(chat, claim);
      for (const journeyId of journeyIds) completedJourneyIds.add(journeyId);
      return chat;
    })();
    activeFlight = { journeyIds, promise };
    try {
      return await promise;
    } catch (error) {
      for (const journeyId of journeyIds) claimedJourneyIds.delete(journeyId);
      throw error;
    } finally {
      if (activeFlight?.promise === promise) activeFlight = null;
    }
  };

  return { claimSetupLaunch, launch };
}

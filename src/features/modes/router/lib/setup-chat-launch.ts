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
  getCurrentLaunchRequest?: () => SetupLaunchRequest | null;
  reconcileChat?: (
    chat: TChat,
    input: { name: string; mode: SetupJourneyMode; characterIds: string[]; connectionId: string },
  ) => Promise<TChat>;
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
  let terminalFailure: { error: unknown } | null = null;

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
    if (terminalFailure) throw terminalFailure.error;
    if (activeFlight && request.intent && request.ready && !request.intent.dismissed && !request.intent.completed) {
      activeFlight.journeyIds.add(request.intent.journeyId);
      return activeFlight.promise;
    }
    const claim = claimSetupLaunch(request);
    if (!claim) return null;
    const journeyIds = new Set([claim.journeyId]);
    let chatCreated = false;
    const promise = (async () => {
      let effectiveClaim = claim;
      let characterContext = effectiveClaim.originCharacterId && dependencies.resolveCharacterLaunchContext
        ? await dependencies.resolveCharacterLaunchContext(effectiveClaim.originCharacterId)
        : null;
      const createInput = {
        name: characterContext?.characterName
          ? `${characterContext.characterName} - ${modeLabel(effectiveClaim.mode)}`
          : `New ${modeLabel(effectiveClaim.mode)}`,
        mode: effectiveClaim.mode,
        characterIds: effectiveClaim.originCharacterId ? [effectiveClaim.originCharacterId] : [],
        connectionId: effectiveClaim.connectionId,
      };
      let chat = await dependencies.createChat(createInput);
      chatCreated = true;

      const currentRequest = dependencies.getCurrentLaunchRequest?.();
      if (currentRequest?.intent?.journeyId && currentRequest.intent.journeyId !== effectiveClaim.journeyId) {
        const latestClaim = claimSetupLaunch(currentRequest);
        if (latestClaim) {
          journeyIds.add(latestClaim.journeyId);
          effectiveClaim = latestClaim;
          characterContext = effectiveClaim.originCharacterId && dependencies.resolveCharacterLaunchContext
            ? await dependencies.resolveCharacterLaunchContext(effectiveClaim.originCharacterId)
            : null;
          const latestInput = {
            name: characterContext?.characterName
              ? `${characterContext.characterName} - ${modeLabel(effectiveClaim.mode)}`
              : `New ${modeLabel(effectiveClaim.mode)}`,
            mode: effectiveClaim.mode,
            characterIds: effectiveClaim.originCharacterId ? [effectiveClaim.originCharacterId] : [],
            connectionId: effectiveClaim.connectionId,
          };
          if (!dependencies.reconcileChat) throw new Error("Cannot reconcile an in-flight setup chat");
          chat = await dependencies.reconcileChat(chat, latestInput);
        }
      }
      try {
        await dependencies.applyStarredPreset({ mode: effectiveClaim.mode, chatId: chat.id });
      } catch {
        // Preset application is optional; the successfully created chat remains usable.
      }
      if (effectiveClaim.originCharacterId && characterContext && dependencies.initializeCharacterChat) {
        try {
          await dependencies.initializeCharacterChat(
            chat.id,
            effectiveClaim.originCharacterId,
            characterContext,
            effectiveClaim,
          );
        } catch {
          // Greeting setup is optional; the successfully created chat must still be finalized.
        }
      }
      await dependencies.complete(chat, effectiveClaim);
      for (const journeyId of journeyIds) completedJourneyIds.add(journeyId);
      return chat;
    })();
    activeFlight = { journeyIds, promise };
    try {
      return await promise;
    } catch (error) {
      if (chatCreated) terminalFailure = { error };
      else for (const journeyId of journeyIds) claimedJourneyIds.delete(journeyId);
      throw error;
    } finally {
      if (activeFlight?.promise === promise) activeFlight = null;
    }
  };

  return { claimSetupLaunch, launch };
}

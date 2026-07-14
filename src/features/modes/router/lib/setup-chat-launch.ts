import type {
  SetupJourneyIntent,
  SetupJourneyMode,
  SetupJourneyRecovery,
  SetupJourneyRecoveryStage,
} from "../../../../engine/onboarding";

export interface SetupLaunchRequest {
  intent: SetupJourneyIntent | null;
  ready: boolean;
  usableConnectionIds: string[];
}

export interface SetupLaunchOptions {
  skipStarredPreset?: boolean;
}

export class SetupPresetApplicationError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "The starred chat preset could not be applied.");
    this.name = "SetupPresetApplicationError";
    this.cause = cause;
  }
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

export interface CharacterInitializationResult {
  cleanup?: () => Promise<void>;
}

interface SetupChatLaunchDependencies<TChat extends CreatedChat> {
  createChat: (input: {
    name: string;
    mode: SetupJourneyMode;
    characterIds: string[];
    connectionId: string;
  }) => Promise<TChat>;
  applyStarredPreset: (input: { mode: SetupJourneyMode; chatId: string }) => Promise<unknown>;
  getRecovery?: () => SetupJourneyRecovery | null;
  recordRecovery?: (recovery: SetupJourneyRecovery) => void;
  clearRecovery?: () => void;
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
  ) => Promise<CharacterInitializationResult | void>;
  complete: (chat: TChat, claim: ClaimedSetupLaunch) => void | Promise<void>;
}

function modeLabel(mode: SetupJourneyMode): string {
  if (mode === "conversation") return "Conversation";
  if (mode === "roleplay") return "Roleplay";
  return "Game";
}

const recoveryStageOrder: Record<SetupJourneyRecoveryStage, number> = {
  created: 0,
  reconciled: 1,
  "preset-applied": 2,
  "greeting-initialized": 3,
  finalizing: 4,
};

function hasReached(stage: SetupJourneyRecoveryStage, target: SetupJourneyRecoveryStage): boolean {
  return recoveryStageOrder[stage] >= recoveryStageOrder[target];
}

export function createSetupChatLaunchOrchestrator<TChat extends CreatedChat>(
  dependencies: SetupChatLaunchDependencies<TChat>,
) {
  let nextToken = 0;
  const claimedJourneyIds = new Set<string>();
  const completedJourneyIds = new Set<string>();
  let activeFlight: { journeyIds: Set<string>; promise: Promise<TChat> } | null = null;
  let unrecoverableFailure: { error: unknown } | null = null;

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

  const launch = async (request: SetupLaunchRequest, options: SetupLaunchOptions = {}): Promise<TChat | null> => {
    if (unrecoverableFailure) throw unrecoverableFailure.error;
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
      const recovery = dependencies.getRecovery?.() ?? null;
      let recoveryStage: SetupJourneyRecoveryStage = recovery?.stage ?? "created";
      let chat: TChat;
      if (recovery) {
        chatCreated = true;
        chat = { id: recovery.createdChatId } as TChat;
        if (recovery.journeyId !== effectiveClaim.journeyId || !hasReached(recoveryStage, "reconciled")) {
          if (!dependencies.reconcileChat) throw new Error("Cannot repair a created setup chat");
          chat = await dependencies.reconcileChat(chat, createInput);
          recoveryStage = "reconciled";
          dependencies.recordRecovery?.({
            createdChatId: chat.id,
            journeyId: effectiveClaim.journeyId,
            stage: recoveryStage,
          });
        }
      } else {
        chat = await dependencies.createChat(createInput);
        chatCreated = true;
        dependencies.recordRecovery?.({
          createdChatId: chat.id,
          journeyId: effectiveClaim.journeyId,
          stage: "created",
        });
      }

      const stabilizeIdentity = async (cleanup?: () => Promise<void>): Promise<boolean> => {
        const currentRequest = dependencies.getCurrentLaunchRequest?.();
        if (!currentRequest?.intent?.journeyId || currentRequest.intent.journeyId === effectiveClaim.journeyId) {
          return false;
        }
        const latestClaim = claimSetupLaunch(currentRequest);
        if (!latestClaim) throw new Error("Latest setup intent is not ready for finalization");
        if (cleanup) await cleanup();
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
        recoveryStage = "reconciled";
        dependencies.recordRecovery?.({
          createdChatId: chat.id,
          journeyId: effectiveClaim.journeyId,
          stage: recoveryStage,
        });
        return true;
      };

      if (await stabilizeIdentity()) {
        // The loop below will apply every post-reconciliation stage for the latest identity.
      } else if (!hasReached(recoveryStage, "reconciled")) {
        recoveryStage = "reconciled";
        dependencies.recordRecovery?.({ createdChatId: chat.id, journeyId: effectiveClaim.journeyId, stage: recoveryStage });
      }

      let stable = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!hasReached(recoveryStage, "preset-applied")) {
          if (!options.skipStarredPreset) {
            try {
              await dependencies.applyStarredPreset({ mode: effectiveClaim.mode, chatId: chat.id });
            } catch (error) {
              throw new SetupPresetApplicationError(error);
            }
          }
          recoveryStage = "preset-applied";
          dependencies.recordRecovery?.({ createdChatId: chat.id, journeyId: effectiveClaim.journeyId, stage: recoveryStage });
          if (await stabilizeIdentity()) continue;
        }

        if (!hasReached(recoveryStage, "greeting-initialized")) {
          let initialization: CharacterInitializationResult | void = undefined;
          if (effectiveClaim.originCharacterId && characterContext && dependencies.initializeCharacterChat) {
            try {
              initialization = await dependencies.initializeCharacterChat(
                chat.id,
                effectiveClaim.originCharacterId,
                characterContext,
                effectiveClaim,
              );
            } catch {
              // Greeting setup is optional; the successfully created chat must still be finalized.
            }
          }
          recoveryStage = "greeting-initialized";
          dependencies.recordRecovery?.({ createdChatId: chat.id, journeyId: effectiveClaim.journeyId, stage: recoveryStage });
          if (await stabilizeIdentity(initialization?.cleanup)) continue;
        }

        if (await stabilizeIdentity()) continue;
        stable = true;
        break;
      }
      if (!stable) throw new Error("Setup intent changed too often to finalize safely");
      dependencies.recordRecovery?.({
        createdChatId: chat.id,
        journeyId: effectiveClaim.journeyId,
        stage: "finalizing",
      });
      await dependencies.complete(chat, effectiveClaim);
      dependencies.clearRecovery?.();
      for (const journeyId of journeyIds) completedJourneyIds.add(journeyId);
      return chat;
    })();
    activeFlight = { journeyIds, promise };
    try {
      return await promise;
    } catch (error) {
      if (chatCreated && !dependencies.getRecovery?.()) unrecoverableFailure = { error };
      for (const journeyId of journeyIds) claimedJourneyIds.delete(journeyId);
      throw error;
    } finally {
      if (activeFlight?.promise === promise) activeFlight = null;
    }
  };

  return { claimSetupLaunch, launch };
}

import type { SetupJourneyIntent, SetupJourneyMode } from "../../../../engine/onboarding";

export interface SetupLaunchRequest {
  intent: SetupJourneyIntent | null;
  ready: boolean;
  usableConnectionIds: string[];
}

export interface ClaimedSetupLaunch {
  token: number;
  mode: SetupJourneyMode;
  originCharacterId: string | null;
  connectionId: string;
}

interface CreatedChat {
  id: string;
}

interface SetupChatLaunchDependencies<TChat extends CreatedChat> {
  createChat: (input: {
    name: string;
    mode: SetupJourneyMode;
    characterIds: string[];
    connectionId: string;
  }) => Promise<TChat>;
  applyStarredPreset: (input: { mode: SetupJourneyMode; chatId: string }) => Promise<unknown>;
  complete: (chat: TChat, claim: ClaimedSetupLaunch) => void | Promise<void>;
}

function intentKey(intent: SetupJourneyIntent): string {
  return `${intent.mode}:${intent.originCharacterId ?? ""}:${intent.selectedConnectionId ?? ""}`;
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
  let activeClaim: (ClaimedSetupLaunch & { key: string }) | null = null;
  const completedKeys = new Set<string>();

  const claimSetupLaunch = (request: SetupLaunchRequest): ClaimedSetupLaunch | null => {
    const { intent, ready, usableConnectionIds } = request;
    if (!intent || !ready || intent.dismissed || intent.completed) return null;
    const key = intentKey(intent);
    if (activeClaim?.key === key || completedKeys.has(key)) return null;
    const connectionId =
      (intent.selectedConnectionId && usableConnectionIds.includes(intent.selectedConnectionId)
        ? intent.selectedConnectionId
        : usableConnectionIds[0]) ?? null;
    if (!connectionId) return null;

    activeClaim = {
      key,
      token: ++nextToken,
      mode: intent.mode,
      originCharacterId: intent.originCharacterId,
      connectionId,
    };
    return activeClaim;
  };

  const launch = async (request: SetupLaunchRequest): Promise<TChat | null> => {
    const claim = claimSetupLaunch(request);
    if (!claim) return null;
    const key = intentKey(request.intent!);

    let chat: TChat;
    try {
      chat = await dependencies.createChat({
        name: `New ${modeLabel(claim.mode)}`,
        mode: claim.mode,
        characterIds: claim.originCharacterId ? [claim.originCharacterId] : [],
        connectionId: claim.connectionId,
      });
    } catch (error) {
      if (activeClaim?.token === claim.token) activeClaim = null;
      throw error;
    }

    if (activeClaim?.token !== claim.token) return chat;
    try {
      await dependencies.applyStarredPreset({ mode: claim.mode, chatId: chat.id });
    } catch {
      // Preset application is optional; the successfully created chat remains usable.
    }
    if (activeClaim?.token !== claim.token) return chat;
    completedKeys.add(key);
    activeClaim = null;
    await dependencies.complete(chat, claim);
    return chat;
  };

  return { claimSetupLaunch, launch };
}

export type SetupJourneyMode = "conversation" | "roleplay" | "game";

export type SetupJourneyAction =
  | "configure-runtime"
  | "repair-runtime"
  | "create-connection"
  | "configure-chat"
  | "choose-experience"
  | "complete";

export interface SetupJourneyIntent {
  journeyId: string;
  mode: SetupJourneyMode;
  originCharacterId: string | null;
  selectedConnectionId: string | null;
  dismissed: boolean;
  completed: boolean;
}

export type SetupJourneyRecoveryStage =
  | "created"
  | "reconciled"
  | "preset-applied"
  | "greeting-initialized"
  | "finalizing";

export interface SetupJourneyRecovery {
  createdChatId: string;
  journeyId: string;
  stage: SetupJourneyRecoveryStage;
}

export interface SetupReadinessFacts {
  environment: "embedded" | "web";
  runtimeUrl: string | null;
  runtimeHealth: "not-required" | "unknown" | "healthy" | "error";
  usableConnectionCount: number;
}

export function isSetupReady(facts: SetupReadinessFacts): boolean {
  const runtimeReady =
    facts.environment === "embedded" || (!!facts.runtimeUrl?.trim() && facts.runtimeHealth === "healthy");
  return runtimeReady && facts.usableConnectionCount > 0;
}

export function deriveSetupJourneyAction(
  facts: SetupReadinessFacts,
  intent: SetupJourneyIntent | null,
): SetupJourneyAction {
  if (intent?.completed) return "complete";

  if (facts.environment === "web") {
    if (!facts.runtimeUrl?.trim()) return "configure-runtime";
    if (facts.runtimeHealth !== "healthy") return "repair-runtime";
  }

  if (facts.usableConnectionCount < 1) return "create-connection";
  return intent ? "configure-chat" : "choose-experience";
}

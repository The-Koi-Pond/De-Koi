import type {
  ContinuityDirectorSourceSnapshot,
  RoleplayContinuityDirectorState,
} from "../../../contracts/types/roleplay-continuity-director";

export type ContinuityDirectorRefreshTrigger = "scene_created" | "scene_concluded" | "assistant_saved";

export type ContinuityDirectorRefreshDecision =
  | {
      eligible: true;
      reason: "scene_source_changed";
    }
  | {
      eligible: true;
      reason: "cadence_due";
      assistantTurnsElapsed: number;
    }
  | {
      eligible: false;
      reason: "disabled" | "manual" | "pending" | "trigger_mismatch" | "source_unchanged" | "cadence_not_due";
      assistantTurnsElapsed?: number;
    };

export interface ContinuityDirectorRefreshPolicyInput {
  state: RoleplayContinuityDirectorState;
  trigger: ContinuityDirectorRefreshTrigger;
  currentSourceSnapshot: ContinuityDirectorSourceSnapshot;
  refreshPending: boolean;
}

function assistantTurnsElapsed(
  current: ContinuityDirectorSourceSnapshot,
  previous: ContinuityDirectorSourceSnapshot | null,
): number {
  const currentCount = Math.max(0, current.visibleAssistantTurnCount ?? 0);
  if (!previous) return currentCount;
  return Math.max(0, currentCount - Math.max(0, previous.visibleAssistantTurnCount ?? 0));
}

export function decideContinuityDirectorRefresh(
  input: ContinuityDirectorRefreshPolicyInput,
): ContinuityDirectorRefreshDecision {
  if (!input.state.enabled) return { eligible: false, reason: "disabled" };
  if (input.state.refreshMode === "manual") return { eligible: false, reason: "manual" };
  if (input.refreshPending) return { eligible: false, reason: "pending" };

  if (input.state.refreshMode === "scene_events") {
    if (input.trigger !== "scene_created" && input.trigger !== "scene_concluded") {
      return { eligible: false, reason: "trigger_mismatch" };
    }
    if (input.state.sourceSnapshot?.fingerprint === input.currentSourceSnapshot.fingerprint) {
      return { eligible: false, reason: "source_unchanged" };
    }
    return { eligible: true, reason: "scene_source_changed" };
  }

  if (input.trigger !== "assistant_saved") return { eligible: false, reason: "trigger_mismatch" };
  const elapsed = assistantTurnsElapsed(input.currentSourceSnapshot, input.state.sourceSnapshot);
  const cadence = input.state.refreshEveryAssistantTurns ?? 10;
  if (input.state.sourceSnapshot && elapsed < cadence) {
    return { eligible: false, reason: "cadence_not_due", assistantTurnsElapsed: elapsed };
  }
  return { eligible: true, reason: "cadence_due", assistantTurnsElapsed: elapsed };
}

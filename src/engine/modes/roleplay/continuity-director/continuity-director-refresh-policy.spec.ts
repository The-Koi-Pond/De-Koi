import { describe, expect, it } from "vitest";

import type {
  ContinuityDirectorSourceSnapshot,
  RoleplayContinuityDirectorState,
} from "../../../contracts/types/roleplay-continuity-director";
import { createDefaultContinuityDirectorState } from "./continuity-director-state";
import { decideContinuityDirectorRefresh } from "./continuity-director-refresh-policy";

const NOW = "2026-09-02T12:00:00.000Z";

function snapshot(fingerprint: string, visibleAssistantTurnCount: number): ContinuityDirectorSourceSnapshot {
  return {
    storyProjectionIds: [],
    knowledgeEdgeIds: [],
    lastMessageId: `message-${visibleAssistantTurnCount}`,
    visibleAssistantTurnCount,
    fingerprint,
    generatedAt: NOW,
  };
}

function state(overrides: Partial<RoleplayContinuityDirectorState> = {}): RoleplayContinuityDirectorState {
  return {
    ...createDefaultContinuityDirectorState(NOW),
    enabled: true,
    sourceSnapshot: snapshot("old", 4),
    ...overrides,
  };
}

describe("continuity director refresh policy", () => {
  it("never schedules disabled, manual, or already-pending directors", () => {
    const currentSourceSnapshot = snapshot("new", 20);

    expect(
      decideContinuityDirectorRefresh({
        state: state({ enabled: false, refreshMode: "cadence", refreshEveryAssistantTurns: 5 }),
        trigger: "assistant_saved",
        currentSourceSnapshot,
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "disabled" });
    expect(
      decideContinuityDirectorRefresh({
        state: state({ refreshMode: "manual" }),
        trigger: "assistant_saved",
        currentSourceSnapshot,
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "manual" });
    expect(
      decideContinuityDirectorRefresh({
        state: state({ refreshMode: "cadence", refreshEveryAssistantTurns: 5 }),
        trigger: "assistant_saved",
        currentSourceSnapshot,
        refreshPending: true,
      }),
    ).toMatchObject({ eligible: false, reason: "pending" });
  });

  it("allows scene mode only after successful scene events with changed sources", () => {
    const director = state({ refreshMode: "scene_events" });

    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "scene_created",
        currentSourceSnapshot: snapshot("new", 4),
        refreshPending: false,
      }),
    ).toEqual({ eligible: true, reason: "scene_source_changed" });
    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "scene_concluded",
        currentSourceSnapshot: snapshot("old", 4),
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "source_unchanged" });
    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("new", 5),
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "trigger_mismatch" });
  });

  it("allows cadence only on a saved assistant turn after the configured boundary", () => {
    const director = state({ refreshMode: "cadence", refreshEveryAssistantTurns: 5 });

    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("new", 8),
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "cadence_not_due", assistantTurnsElapsed: 4 });
    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("new", 9),
        refreshPending: false,
      }),
    ).toEqual({ eligible: true, reason: "cadence_due", assistantTurnsElapsed: 5 });
    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "scene_created",
        currentSourceSnapshot: snapshot("new", 20),
        refreshPending: false,
      }),
    ).toMatchObject({ eligible: false, reason: "trigger_mismatch" });
  });

  it("treats a missing prior snapshot as due for an eligible automatic trigger", () => {
    expect(
      decideContinuityDirectorRefresh({
        state: state({ refreshMode: "scene_events", sourceSnapshot: null }),
        trigger: "scene_created",
        currentSourceSnapshot: snapshot("first", 0),
        refreshPending: false,
      }),
    ).toEqual({ eligible: true, reason: "scene_source_changed" });
    expect(
      decideContinuityDirectorRefresh({
        state: state({ refreshMode: "cadence", refreshEveryAssistantTurns: 10, sourceSnapshot: null }),
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("first", 1),
        refreshPending: false,
      }),
    ).toEqual({ eligible: true, reason: "cadence_due", assistantTurnsElapsed: 1 });
  });

  it("waits ten additional assistant replies after a failed initial planning attempt", () => {
    const director = state({
      refreshMode: "cadence",
      refreshEveryAssistantTurns: 10,
      sourceSnapshot: null,
      lastPlanningAttemptAssistantTurnCount: 7,
    });

    for (let reply = 1; reply <= 9; reply += 1) {
      expect(
        decideContinuityDirectorRefresh({
          state: director,
          trigger: "assistant_saved",
          currentSourceSnapshot: snapshot(`reply-${reply}`, 7 + reply),
          refreshPending: false,
        }),
      ).toEqual({ eligible: false, reason: "cadence_not_due", assistantTurnsElapsed: reply });
    }

    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("reply-10", 17),
        refreshPending: false,
      }),
    ).toEqual({ eligible: true, reason: "cadence_due", assistantTurnsElapsed: 10 });
  });

  it("uses the newest real snapshot or failed-attempt count as the cadence baseline", () => {
    const director = state({
      refreshMode: "cadence",
      refreshEveryAssistantTurns: 10,
      sourceSnapshot: snapshot("successful", 12),
      lastPlanningAttemptAssistantTurnCount: 15,
    });

    expect(
      decideContinuityDirectorRefresh({
        state: director,
        trigger: "assistant_saved",
        currentSourceSnapshot: snapshot("after-failure", 24),
        refreshPending: false,
      }),
    ).toEqual({ eligible: false, reason: "cadence_not_due", assistantTurnsElapsed: 9 });
  });
});

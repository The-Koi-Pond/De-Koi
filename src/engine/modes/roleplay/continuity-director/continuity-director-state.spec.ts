import { describe, expect, it } from "vitest";

import type { RoleplayContinuityDirectorState } from "../../../contracts/types/roleplay-continuity-director";
import {
  applyContinuityDirectorCommand,
  createDefaultContinuityDirectorState,
  normalizeContinuityDirectorState,
} from "./continuity-director-state";

const NOW = "2026-09-02T12:00:00.000Z";

function commandOptions() {
  let id = 0;
  return {
    now: () => NOW,
    createId: (prefix: string) => `${prefix}-${++id}`,
  };
}

function proposedState(): RoleplayContinuityDirectorState {
  const options = commandOptions();
  let state = createDefaultContinuityDirectorState(NOW);
  state = applyContinuityDirectorCommand(
    state,
    {
      type: "replace_director_proposals",
      arc: "The city closes in.",
      threads: ["Who stole the map?"],
      beats: ["Mara reveals the forged seal.", "The bridge guard arrives."],
    },
    options,
  );
  return state;
}

describe("continuity director state", () => {
  it("defaults missing state to a disabled manual resource", () => {
    expect(normalizeContinuityDirectorState(undefined, NOW)).toEqual(createDefaultContinuityDirectorState(NOW));
    expect(createDefaultContinuityDirectorState(NOW)).toMatchObject({
      version: 1,
      revision: 0,
      enabled: false,
      connectionId: null,
      refreshMode: "manual",
      refreshEveryAssistantTurns: null,
      currentArc: null,
      openThreads: [],
      beats: [],
      sourceSnapshot: null,
      updatedAt: NOW,
    });
  });

  it("normalizes malformed and future-version metadata without throwing", () => {
    expect(normalizeContinuityDirectorState({ version: 99, enabled: true }, NOW)).toMatchObject({
      version: 1,
      enabled: false,
      beats: [],
    });
    expect(normalizeContinuityDirectorState("broken", NOW)).toMatchObject({ version: 1, enabled: false });
  });

  it("applies settings commands without destroying the saved plan", () => {
    const options = commandOptions();
    let state = proposedState();

    state = applyContinuityDirectorCommand(state, { type: "set_enabled", enabled: true }, options);
    state = applyContinuityDirectorCommand(state, { type: "set_connection", connectionId: " local-llm " }, options);
    state = applyContinuityDirectorCommand(
      state,
      { type: "set_refresh_policy", mode: "cadence", everyAssistantTurns: 10 },
      options,
    );
    state = applyContinuityDirectorCommand(state, { type: "set_enabled", enabled: false }, options);

    expect(state).toMatchObject({
      enabled: false,
      connectionId: "local-llm",
      refreshMode: "cadence",
      refreshEveryAssistantTurns: 10,
      revision: 5,
    });
    expect(state.beats).toHaveLength(2);
  });

  it("limits cadence to the supported low-frequency choices", () => {
    const options = commandOptions();
    const state = applyContinuityDirectorCommand(
      createDefaultContinuityDirectorState(NOW),
      { type: "set_refresh_policy", mode: "cadence", everyAssistantTurns: 1 },
      options,
    );

    expect(state.refreshEveryAssistantTurns).toBe(10);
    expect(
      normalizeContinuityDirectorState({ ...state, refreshEveryAssistantTurns: 7 }, NOW).refreshEveryAssistantTurns,
    ).toBe(10);
  });

  it("makes every user edit durable across later proposal replacement", () => {
    const options = commandOptions();
    let state = proposedState();
    const [first, second] = state.beats;

    state = applyContinuityDirectorCommand(state, { type: "edit_arc", text: "Keep the mystery intimate." }, options);
    state = applyContinuityDirectorCommand(
      state,
      { type: "edit_thread", threadId: state.openThreads[0].id, text: "Who framed Mara?" },
      options,
    );
    state = applyContinuityDirectorCommand(
      state,
      { type: "edit_beat", beatId: first.id, text: "Mara notices the forged seal." },
      options,
    );
    state = applyContinuityDirectorCommand(
      state,
      { type: "set_beat_status", beatId: first.id, status: "approved" },
      options,
    );
    state = applyContinuityDirectorCommand(
      state,
      { type: "set_beat_status", beatId: second.id, status: "deferred" },
      options,
    );
    state = applyContinuityDirectorCommand(
      state,
      {
        type: "replace_director_proposals",
        arc: "Replace me",
        threads: ["Replace me"],
        beats: ["A new candidate beat."],
      },
      options,
    );

    expect(state.currentArc).toMatchObject({ text: "Keep the mystery intimate.", source: "user" });
    expect(state.openThreads).toEqual([
      expect.objectContaining({ text: "Who framed Mara?", source: "user" }),
      expect.objectContaining({ text: "Replace me", source: "director" }),
    ]);
    expect(state.beats).toEqual([
      expect.objectContaining({
        id: first.id,
        text: "Mara notices the forged seal.",
        source: "user",
        status: "approved",
      }),
      expect.objectContaining({ id: second.id, status: "deferred" }),
      expect.objectContaining({ text: "A new candidate beat.", source: "director", status: "proposed" }),
    ]);
  });

  it("supports reject, fulfill, reorder, and reroll without losing history", () => {
    const options = commandOptions();
    let state = proposedState();
    const [first, second] = state.beats;

    state = applyContinuityDirectorCommand(state, { type: "move_beat", beatId: second.id, direction: "up" }, options);
    expect(state.beats.map((beat) => beat.id)).toEqual([second.id, first.id]);

    state = applyContinuityDirectorCommand(
      state,
      { type: "set_beat_status", beatId: first.id, status: "fulfilled" },
      options,
    );
    state = applyContinuityDirectorCommand(
      state,
      { type: "reroll_beat", beatId: second.id, replacementText: "The watch captain recognizes the seal." },
      options,
    );

    expect(state.beats).toEqual([
      expect.objectContaining({ id: second.id, status: "rejected", resolution: "rerolled" }),
      expect.objectContaining({ id: first.id, status: "fulfilled" }),
      expect.objectContaining({
        text: "The watch captain recognizes the seal.",
        status: "proposed",
        source: "director",
      }),
    ]);
    expect(state.beats.map((beat) => beat.order)).toEqual([0, 1, 2]);
  });

  it("enforces text and collection bounds while preserving decided history", () => {
    const options = commandOptions();
    let state = createDefaultContinuityDirectorState(NOW);
    state = applyContinuityDirectorCommand(
      state,
      {
        type: "replace_director_proposals",
        arc: "a".repeat(700),
        threads: Array.from({ length: 15 }, (_, index) => `Thread ${index} ${"t".repeat(300)}`),
        beats: Array.from({ length: 12 }, (_, index) => `Beat ${index} ${"b".repeat(300)}`),
      },
      options,
    );

    expect(state.currentArc?.text).toHaveLength(600);
    expect(state.openThreads).toHaveLength(12);
    expect(state.openThreads.every((thread) => thread.text.length <= 280)).toBe(true);
    expect(state.beats).toHaveLength(8);
    expect(state.beats.every((beat) => beat.text.length <= 280)).toBe(true);

    for (const beat of state.beats) {
      state = applyContinuityDirectorCommand(
        state,
        { type: "set_beat_status", beatId: beat.id, status: "rejected" },
        options,
      );
    }
    state = applyContinuityDirectorCommand(
      state,
      { type: "replace_director_proposals", beats: Array.from({ length: 20 }, (_, index) => `New ${index}`) },
      options,
    );
    expect(state.beats).toHaveLength(16);
    expect(state.beats.filter((beat) => beat.status === "rejected")).toHaveLength(8);
    expect(state.beats.filter((beat) => beat.status === "proposed")).toHaveLength(8);
  });
});

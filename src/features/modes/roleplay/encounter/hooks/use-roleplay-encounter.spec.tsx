import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENCOUNTER_SETUP_INVALID_MESSAGE,
  ENCOUNTER_TURN_INVALID_MESSAGE,
} from "../../../../../engine/modes/roleplay/encounter/encounter-calls";
import type {
  EncounterFight,
  EncounterSettings,
  EncounterTurnOutcome,
} from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { userFacingError } from "../../../../../engine/shared/user-facing-error";
import { useRoleplayEncounterStore } from "../../../../../shared/stores/roleplay-encounter.store";
import { useRoleplayEncounter } from "./use-roleplay-encounter";

const service = vi.hoisted(() => ({
  startEncounterFight: vi.fn(),
  resolveEncounterTurn: vi.fn(),
  writeEncounterSummary: vi.fn(),
}));

vi.mock("../../../../../engine/modes/roleplay/encounter/encounter-calls", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...service,
}));
vi.mock("../../../../../shared/api/llm-api", () => ({ llmApi: {} }));
vi.mock("../../../../../shared/api/storage-api", () => ({ storageApi: {} }));

const narration = { tense: "present", person: "third", narration: "omniscient", pov: "narrator" } as const;
const settings: EncounterSettings = {
  combatNarration: narration,
  summaryNarration: narration,
  spellbookId: null,
  historyDepth: 8,
};

const fight: EncounterFight = {
  party: [{ name: "Mira", hp: 20, maxHp: 20, attacks: [], items: [], statuses: [], isPlayer: true }],
  enemies: [{ name: "Warden", hp: 18, maxHp: 18, attacks: [], statuses: [], description: "", sprite: "" }],
  environment: "A hall.",
  styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
  playerActions: { attacks: [], items: [] },
};

const victory: EncounterTurnOutcome = {
  fight: { ...fight, enemies: [{ ...fight.enemies[0]!, hp: 0 }] },
  round: { action: "Strike", enemyActions: [], partyActions: [], narrative: "The warden falls." },
  log: [{ kind: "narration", text: "The warden falls." }],
  result: "victory",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useRoleplayEncounter", () => {
  let encounter: ReturnType<typeof useRoleplayEncounter>;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  const state = () => useRoleplayEncounterStore.getState();

  function Harness() {
    encounter = useRoleplayEncounter();
    return null;
  }

  async function startFight() {
    service.startEncounterFight.mockResolvedValueOnce(fight);
    encounter.openSetup("chat-a");
    await act(() => encounter.begin(settings));
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.values(service).forEach((mock) => mock.mockReset());
    state().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    state().reset();
  });

  it("shows the setup error for junk output and calls again on Retry", async () => {
    service.startEncounterFight.mockRejectedValueOnce(userFacingError(ENCOUNTER_SETUP_INVALID_MESSAGE));
    encounter.openSetup("chat-a");
    await act(() => encounter.begin(settings));

    expect(state().encounter).toMatchObject({ stage: "start-failed", startError: ENCOUNTER_SETUP_INVALID_MESSAGE });

    service.startEncounterFight.mockResolvedValueOnce(fight);
    await act(() => encounter.retryStart());

    expect(service.startEncounterFight).toHaveBeenCalledTimes(2);
    expect(service.startEncounterFight.mock.calls[1]?.[1]).toMatchObject({ chatId: "chat-a", settings });
    expect(state().encounter?.stage).toBe("fighting");
  });

  it("shows the invalid-response message for a failed turn and keeps the fight", async () => {
    await startFight();
    service.resolveEncounterTurn.mockRejectedValueOnce(new Error("bad json"));

    await act(() => encounter.sendAction("Strike"));

    expect(state().encounter).toMatchObject({
      stage: "fighting",
      fight,
      rounds: [],
      turnError: ENCOUNTER_TURN_INVALID_MESSAGE,
    });
  });

  it("writes the summary after a winning turn and refreshes the chat's messages", async () => {
    await startFight();
    service.resolveEncounterTurn.mockResolvedValueOnce(victory);
    service.writeEncounterSummary.mockResolvedValueOnce("The warden fell.");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(() => encounter.sendAction("Strike"));

    expect(service.writeEncounterSummary).toHaveBeenCalledTimes(1);
    expect(service.writeEncounterSummary.mock.calls[0]?.[1]).toMatchObject({
      chatId: "chat-a",
      result: "victory",
      rounds: [victory.round],
    });
    expect(state().encounter).toMatchObject({ stage: "ended", result: "victory", summaryStatus: "written" });
    expect(invalidate).toHaveBeenCalled();
  });

  it("offers Try again after a failed summary and refreshes nothing", async () => {
    await startFight();
    service.writeEncounterSummary.mockRejectedValueOnce(new Error("provider failed"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(() => encounter.conclude());
    expect(state().encounter).toMatchObject({ result: "interrupted", summaryStatus: "failed" });
    expect(invalidate).not.toHaveBeenCalled();

    service.writeEncounterSummary.mockResolvedValueOnce("Cut short.");
    await act(() => encounter.retrySummary());
    expect(state().encounter?.summaryStatus).toBe("written");
  });

  it("doesn't refresh messages for a summary that answers after you left the chat", async () => {
    await startFight();
    const pending = deferred<string>();
    service.writeEncounterSummary.mockReturnValueOnce(pending.promise);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    let concluding!: Promise<void>;
    act(() => {
      concluding = encounter.conclude();
    });
    const signal = service.writeEncounterSummary.mock.calls[0]?.[1].signal as AbortSignal;
    act(() => state().leaveChat("chat-b"));
    pending.resolve("Too late.");
    await act(() => concluding);

    expect(signal.aborted).toBe(true);
    expect(state().encounter?.summaryStatus).toBe("failed");
    expect(invalidate).not.toHaveBeenCalled();
  });
});

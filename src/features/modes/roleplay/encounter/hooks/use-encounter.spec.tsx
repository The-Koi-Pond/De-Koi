import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CombatInitState, EncounterSettings } from "../../../../../engine/contracts/types/combat-encounter";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useEncounterStore } from "../../../../../shared/stores/encounter.store";
import { useEncounter } from "./use-encounter";

const encounterService = vi.hoisted(() => ({
  initRoleplayEncounter: vi.fn(),
  resolveRoleplayEncounterAction: vi.fn(),
  summarizeRoleplayEncounter: vi.fn(),
}));

vi.mock("../../../../../engine/modes/roleplay/encounter/encounter-service", () => encounterService);
vi.mock("../../../../../shared/api/llm-api", () => ({ llmApi: {} }));
vi.mock("../../../../../shared/api/storage-api", () => ({ storageApi: {} }));

const settings: EncounterSettings = {
  combatNarrative: { tense: "present", person: "third", narration: "omniscient", pov: "narrator" },
  summaryNarrative: { tense: "past", person: "third", narration: "omniscient", pov: "narrator" },
  historyDepth: 8,
};

const combatState: CombatInitState = {
  party: [
    {
      name: "Mira",
      hp: 30,
      maxHp: 30,
      attacks: [],
      items: [],
      statuses: [],
      isPlayer: true,
    },
  ],
  enemies: [],
  environment: "A mirror-bright hall.",
  styleNotes: {
    environmentType: "dungeon",
    atmosphere: "tense",
    timeOfDay: "night",
    weather: "clear",
  },
  itemEffects: [],
  mechanics: [],
  dialogueCues: [],
  visuals: { isBossFight: false, enemyImagePrompts: [] },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useEncounter request ownership", () => {
  let encounter: ReturnType<typeof useEncounter>;
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function Harness() {
    encounter = useEncounter();
    return null;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    encounterService.initRoleplayEncounter.mockReset();
    encounterService.resolveRoleplayEncounterAction.mockReset();
    encounterService.summarizeRoleplayEncounter.mockReset();
    useEncounterStore.getState().reset();
    useChatStore.setState({ activeChatId: "chat-a" });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    useEncounterStore.getState().reset();
    useChatStore.getState().reset();
  });

  it("does not let an older initialization settle a newer same-chat encounter", async () => {
    const pending = deferred<{ combatState: CombatInitState }>();
    encounterService.initRoleplayEncounter.mockReturnValueOnce(pending.promise);
    act(() => encounter.startEncounter());
    let initialization!: Promise<void>;
    act(() => {
      initialization = encounter.initEncounter(settings);
    });

    act(() => encounter.startEncounter());
    const freshRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ combatState });
    await act(async () => initialization);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: freshRequestId,
      showConfigModal: true,
      active: false,
      initialized: false,
      isLoading: false,
    });
  });

  it("cancels initialization lifecycle state when navigating away and back", async () => {
    const pending = deferred<{ combatState: CombatInitState }>();
    encounterService.initRoleplayEncounter.mockReturnValueOnce(pending.promise);
    act(() => encounter.startEncounter());
    let initialization!: Promise<void>;
    act(() => {
      initialization = encounter.initEncounter(settings);
    });

    act(() => useChatStore.setState({ activeChatId: "chat-b" }));
    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-a", active: false, isLoading: false });
    act(() => useChatStore.setState({ activeChatId: "chat-a" }));
    const canceledRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ combatState });
    await act(async () => initialization);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: canceledRequestId,
      active: false,
      initialized: false,
      isLoading: false,
    });
  });

  it("does not let an older action mutate a newer same-chat encounter", async () => {
    act(() => encounter.startEncounter());
    const requestId = useEncounterStore.getState().requestId;
    act(() => useEncounterStore.getState().initCombat("chat-a", requestId, combatState));
    const pending = deferred<{ result: never; invalid: true }>();
    encounterService.resolveRoleplayEncounterAction.mockReturnValueOnce(pending.promise);
    let action!: Promise<void>;
    act(() => {
      action = encounter.sendAction("Strike");
    });

    act(() => encounter.startEncounter());
    const freshRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ result: undefined as never, invalid: true });
    await act(async () => action);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: freshRequestId,
      showConfigModal: true,
      active: false,
      isProcessing: false,
      error: null,
    });
  });

  it("settles action processing when navigating away and back", async () => {
    act(() => encounter.startEncounter());
    const requestId = useEncounterStore.getState().requestId;
    act(() => useEncounterStore.getState().initCombat("chat-a", requestId, combatState));
    const pending = deferred<{ result: never; invalid: true }>();
    encounterService.resolveRoleplayEncounterAction.mockReturnValueOnce(pending.promise);
    let action!: Promise<void>;
    act(() => {
      action = encounter.sendAction("Strike");
    });

    act(() => useChatStore.setState({ activeChatId: "chat-b" }));
    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-a", active: true, isProcessing: false });
    act(() => useChatStore.setState({ activeChatId: "chat-a" }));
    const canceledRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ result: undefined as never, invalid: true });
    await act(async () => action);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: canceledRequestId,
      active: true,
      initialized: true,
      isProcessing: false,
      error: "Encounter action canceled when you left this chat.",
    });
  });

  it("does not let an older summary settle a newer same-chat encounter", async () => {
    act(() => encounter.startEncounter());
    const requestId = useEncounterStore.getState().requestId;
    act(() => useEncounterStore.getState().initCombat("chat-a", requestId, combatState));
    const pending = deferred<{ summary: string; messageId: string }>();
    encounterService.summarizeRoleplayEncounter.mockReturnValueOnce(pending.promise);
    let summary!: Promise<void>;
    act(() => {
      summary = encounter.generateSummary("victory");
    });

    act(() => encounter.startEncounter());
    const freshRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ summary: "The fight ends.", messageId: "message-1" });
    await act(async () => summary);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: freshRequestId,
      showConfigModal: true,
      active: false,
      summaryStatus: "idle",
    });
  });

  it("settles summary state when navigating away and back", async () => {
    act(() => encounter.startEncounter());
    const requestId = useEncounterStore.getState().requestId;
    act(() => useEncounterStore.getState().initCombat("chat-a", requestId, combatState));
    act(() => useEncounterStore.getState().endCombat("victory"));
    const pending = deferred<{ summary: string; messageId: string }>();
    encounterService.summarizeRoleplayEncounter.mockReturnValueOnce(pending.promise);
    let summary!: Promise<void>;
    act(() => {
      summary = encounter.generateSummary("victory");
    });

    act(() => useChatStore.setState({ activeChatId: "chat-b" }));
    expect(useEncounterStore.getState()).toMatchObject({ chatId: "chat-a", summaryStatus: "error" });
    act(() => useChatStore.setState({ activeChatId: "chat-a" }));
    const canceledRequestId = useEncounterStore.getState().requestId;
    pending.resolve({ summary: "The fight ends.", messageId: "message-1" });
    await act(async () => summary);

    expect(useEncounterStore.getState()).toMatchObject({
      chatId: "chat-a",
      requestId: canceledRequestId,
      combatResult: "victory",
      summaryStatus: "done",
    });
  });
});

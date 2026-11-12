import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncounterFight } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { useDialogStore } from "../../../../../shared/stores/dialog.store";
import {
  ENCOUNTER_LEFT_CHAT_MESSAGE,
  useRoleplayEncounterStore,
  type Encounter,
} from "../../../../../shared/stores/roleplay-encounter.store";
import { EncounterHost } from "./EncounterHost";

vi.mock("../../../../../shared/api/llm-api", () => ({ llmApi: {} }));
vi.mock("../../../../../shared/api/storage-api", () => ({ storageApi: {} }));

const fight: EncounterFight = {
  party: [{ name: "Mira", hp: 20, maxHp: 20, attacks: [], items: [], statuses: [], isPlayer: true }],
  enemies: [{ name: "Warden", hp: 18, maxHp: 18, attacks: [], statuses: [], description: "", sprite: "enemy" }],
  environment: "A mirror-bright hall.",
  styleNotes: { environmentType: "dungeon", atmosphere: "tense", timeOfDay: "night", weather: "clear" },
  playerActions: { attacks: [], items: [] },
};

function encounter(overrides: Partial<Encounter>): Encounter {
  return {
    chatId: "chat-a",
    stage: "fighting",
    settings: null,
    fight,
    rounds: [],
    log: [
      { id: 1, kind: "system", text: "Combat begins!" },
      { id: 2, kind: "player", text: "You: Strike" },
      { id: 3, kind: "narration", text: "Steel rings." },
    ],
    result: null,
    startError: null,
    turnError: null,
    summaryStatus: "idle",
    ...overrides,
  };
}

describe("EncounterHost", () => {
  let root: Root;
  let container: HTMLDivElement;

  function show(value: Encounter) {
    useRoleplayEncounterStore.setState({ encounter: value, pending: null });
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <EncounterHost chatId="chat-a" />
        </QueryClientProvider>,
      ),
    );
  }

  const buttonNamed = (name: string) =>
    Array.from(document.body.querySelectorAll("button")).find(
      (button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name,
    );

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useRoleplayEncounterStore.getState().reset();
    useDialogStore.getState().closeDialog();
  });

  it("shows the whole log and the cancel message when you come back after leaving mid-turn", () => {
    show(encounter({ turnError: ENCOUNTER_LEFT_CHAT_MESSAGE }));

    const lines = Array.from(document.body.querySelectorAll('[role="log"] li')).map((line) => line.textContent);
    expect(lines).toEqual(["Combat begins!", "You: Strike", "Steel rings."]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(ENCOUNTER_LEFT_CHAT_MESSAGE);
    expect(document.body.textContent).toContain("👹");
  });

  it("offers Try again and Close anyway after a failed summary", () => {
    show(encounter({ stage: "ended", result: "victory", summaryStatus: "failed" }));

    expect(document.body.textContent).toContain("Failed to generate summary.");
    expect(buttonNamed("Try again")).toBeDefined();
    expect(buttonNamed("Close anyway")).toBeDefined();
  });

  it("is a labeled dialog with focus inside, and Escape asks to end combat", () => {
    show(encounter({}));

    const dialog = document.body.querySelector('[role="dialog"]');
    const titleId = dialog?.getAttribute("aria-labelledby");
    expect(titleId && document.getElementById(titleId)?.textContent).toBe("Combat encounter");
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(buttonNamed("End combat")).toBeDefined();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(useDialogStore.getState().dialog).toMatchObject({
      title: "End combat",
      message: "Close and end this combat?",
    });
  });
});

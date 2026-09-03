import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RoleplayContinuityDirectorState } from "../../../../engine/contracts/types/roleplay-continuity-director";
import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { RoleplayContinuityDirectorModal } from "./RoleplayContinuityDirectorModal";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  refresh: vi.fn(),
  reroll: vi.fn(),
  hook: {} as Record<string, unknown>,
}));

vi.mock("../hooks/use-continuity-director", () => ({
  useContinuityDirector: () => mocks.hook,
}));

vi.mock("../../../catalog/connections", () => ({
  useConnections: () => ({ data: [{ id: "local", name: "Local model", provider: "ollama" }] }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state: RoleplayContinuityDirectorState = {
  ...createDefaultContinuityDirectorState("2026-09-02T12:00:00.000Z"),
  enabled: true,
  revision: 4,
  currentArc: {
    id: "arc-1",
    text: "The forged seal threatens Mara's standing.",
    source: "director",
    createdAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
  },
  openThreads: [],
  beats: [
    {
      id: "beat-1",
      text: "Mara reveals the forged seal.",
      status: "proposed",
      order: 0,
      source: "director",
      sourceIds: [],
      characterIds: ["mara"],
      threadIds: [],
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn();
});

afterEach(async () => {
  mocks.command.mockReset();
  mocks.refresh.mockReset();
  mocks.reroll.mockReset();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderModal(overrides: Record<string, unknown> = {}) {
  mocks.hook = {
    state,
    isStale: true,
    sourceUnavailable: false,
    isLoading: false,
    error: null,
    command: { mutate: mocks.command, isPending: false, error: null },
    refresh: { mutate: mocks.refresh, isPending: false, error: null },
    reroll: { mutate: mocks.reroll, isPending: false, error: null },
    ...overrides,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<RoleplayContinuityDirectorModal chatId="chat-1" open onClose={vi.fn()} />);
    await Promise.resolve();
  });
  return container;
}

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("RoleplayContinuityDirectorModal", () => {
  it("shows the plan and sends revision-guarded beat actions", async () => {
    const element = await renderModal();
    expect(element.textContent).toContain("Plan needs a refresh");
    expect(element.textContent).toContain("The forged seal threatens Mara's standing.");
    expect(element.textContent).toContain("Mara reveals the forged seal.");
    expect(element.textContent).toContain("Proposed");

    await act(async () => click(element.querySelector('button[aria-label="Approve Mara reveals the forged seal."]')));
    expect(mocks.command).toHaveBeenCalledWith(
      {
        command: { type: "set_beat_status", beatId: "beat-1", status: "approved" },
        expectedRevision: 4,
      },
      expect.anything(),
    );

    await act(async () => click(element.querySelector('button[aria-label="Reroll Mara reveals the forged seal."]')));
    expect(mocks.reroll).toHaveBeenCalledWith("beat-1", expect.anything());
  });

  it("supports connection selection and preserves visible state during refresh errors", async () => {
    const element = await renderModal({
      refresh: { mutate: mocks.refresh, isPending: false, error: new Error("Local model timed out") },
    });
    const select = element.querySelector<HTMLSelectElement>('select[aria-label="Continuity Director connection"]');
    if (!select) throw new Error("select not found");
    await act(async () => {
      select.value = "local";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.command).toHaveBeenCalledWith(
      {
        command: { type: "set_connection", connectionId: "local" },
        expectedRevision: 4,
      },
      expect.anything(),
    );

    await act(async () => click(element.querySelector('button[aria-label="Refresh continuity plan"]')));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(element.textContent).toContain("Local model timed out");
    expect(element.textContent).toContain("Mara reveals the forged seal.");
  });

  it("offers only bounded automatic refresh choices and explains background cost", async () => {
    const element = await renderModal({
      state: { ...state, refreshMode: "cadence", refreshEveryAssistantTurns: 10 },
    });
    const cadence = element.querySelector<HTMLSelectElement>('select[aria-label="Continuity Director cadence"]');
    if (!cadence) throw new Error("cadence select not found");

    expect(Array.from(cadence.options).map((option) => option.value)).toEqual(["5", "10", "20"]);
    expect(element.textContent).toContain("Replies never wait for it.");

    await act(async () => {
      cadence.value = "20";
      cadence.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.command).toHaveBeenCalledWith(
      {
        command: { type: "set_refresh_policy", mode: "cadence", everyAssistantTurns: 20 },
        expectedRevision: 4,
      },
      expect.anything(),
    );
  });
});

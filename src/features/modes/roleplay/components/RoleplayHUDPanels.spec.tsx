import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryItem } from "../../../../engine/contracts/types/game-state";
import { CombinedPlayerPanel } from "./RoleplayHUDPanels";
import { useCyclingWidgetIndex } from "./RoleplayHUDWidgetShell";

const pageActivity = vi.hoisted(() => ({ active: true }));

vi.mock("../../../../shared/hooks/use-page-activity", () => ({
  usePageActivity: () => pageActivity.active,
}));

function CyclingWidgetHarness() {
  const { cycleIdx } = useCyclingWidgetIndex(3, 1000);
  return <span data-testid="cycle-index">{cycleIdx}</span>;
}

const inventory: InventoryItem[] = [
  {
    inventoryItemId: "item-1",
    name: "Traveler pack",
    description: "",
    quantity: 1,
    location: "on_person",
  },
];

describe("CombinedPlayerPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("can show inventory independently from the persona tracker section", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <CombinedPlayerPanel
          showPersona={false}
          showCharacters={false}
          showInventory
          showQuests={false}
          showCustomTracker={false}
          personaStats={[]}
          onUpdatePersonaStats={vi.fn()}
          personaStatus=""
          onUpdatePersonaStatus={vi.fn()}
          characters={[]}
          onUpdateCharacters={vi.fn()}
          inventory={inventory}
          onUpdateInventory={vi.fn()}
          quests={[]}
          onUpdateQuests={vi.fn()}
          customTrackerFields={[]}
          onUpdateCustomTracker={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container!.textContent).toContain("Inventory (1)");
    expect(container!.textContent).toContain("Traveler pack");
    expect(container!.textContent).not.toContain("Persona Stats");
  });
});

describe("useCyclingWidgetIndex page activity", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    pageActivity.active = false;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.useRealTimers();
  });

  it("stays still while inactive, resumes once, and clears its timer", () => {
    act(() => {
      root = createRoot(container!);
      root.render(<CyclingWidgetHarness />);
    });

    act(() => vi.advanceTimersByTime(1000));
    expect(container!.textContent).toBe("0");

    pageActivity.active = true;
    act(() => root!.render(<CyclingWidgetHarness />));
    act(() => vi.advanceTimersByTime(1000));
    expect(container!.textContent).toBe("1");
    expect(vi.getTimerCount()).toBe(1);

    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});

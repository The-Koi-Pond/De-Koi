import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryItem } from "../../../../engine/contracts/types/game-state";
import { CombinedPlayerPanel } from "./RoleplayHUDPanels";
import { useCyclingWidgetIndex } from "./RoleplayHUDWidgetShell";
import { NarrativeCraftPanel } from "./NarrativeCraftPanel";

const pageActivity = vi.hoisted(() => ({ active: true }));
const narrativeCraftMocks = vi.hoisted(() => ({
  getMemory: vi.fn(),
  clearMemory: vi.fn(),
  retryAgents: vi.fn(),
  confirm: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../../../shared/hooks/use-page-activity", () => ({
  usePageActivity: () => pageActivity.active,
}));
vi.mock("../../../../shared/api/agent-api", () => ({
  agentApi: {
    getMemory: narrativeCraftMocks.getMemory,
    clearMemory: narrativeCraftMocks.clearMemory,
  },
}));
vi.mock("../../../runtime/generation", () => ({
  useGenerate: () => ({ retryAgents: narrativeCraftMocks.retryAgents }),
}));
vi.mock("../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialog: narrativeCraftMocks.confirm,
}));
vi.mock("sonner", () => ({
  toast: { error: narrativeCraftMocks.toastError },
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
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

describe("NarrativeCraftPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    narrativeCraftMocks.getMemory.mockReset();
    narrativeCraftMocks.clearMemory.mockReset().mockResolvedValue({ deleted: true });
    narrativeCraftMocks.retryAgents.mockReset().mockResolvedValue(undefined);
    narrativeCraftMocks.confirm.mockReset().mockResolvedValue(true);
    narrativeCraftMocks.toastError.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    queryClient.clear();
    container?.remove();
    container = null;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderPanel(isGenerationBusy = false) {
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <QueryClientProvider client={queryClient}>
          <NarrativeCraftPanel
            chatId="chat-1"
            messages={[{ id: "assistant-1", chatId: "chat-1", role: "assistant", content: "Reply" } as never]}
            isGenerationBusy={isGenerationBusy}
          />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 10 && container!.textContent?.includes("Loading craft state"); attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  it("renders normalized state without exposing raw JSON and treats empty guidance as healthy", async () => {
    narrativeCraftMocks.getMemory.mockImplementation(async (agentType: string) => ({
      agentConfigId: agentType,
      memory:
        agentType === "narrative-craft"
          ? {
              state: {
                pacing: "building",
                threads: [
                  { id: "main", summary: "The locked room remains unexplained.", kind: "main", status: "active" },
                  { id: "sub", summary: "Mara owes the ferryman.", kind: "subplot", status: "unresolved" },
                ],
                openQuestions: ["Who moved the key?"],
                unresolvedConsequences: ["The ferryman may collect the debt."],
                lastGuidance: [],
                lastAnalysisReason: "The current scene already has a distinct shape.",
              },
            }
          : null,
    }));

    await renderPanel();

    expect(container!.textContent).toContain("No intervention needed");
    expect(container!.textContent).toContain("Building");
    expect(container!.textContent).toContain("The locked room remains unexplained.");
    expect(container!.textContent).toContain("Mara owes the ferryman.");
    expect(container!.textContent).toContain("Who moved the key?");
    expect(container!.textContent).toContain("The ferryman may collect the debt.");
    expect(container!.textContent).toContain("The current scene already has a distinct shape.");
    expect(container!.textContent).not.toContain('"threads"');
  });

  it("treats missing built-in and legacy config rows as healthy empty state", async () => {
    narrativeCraftMocks.getMemory.mockRejectedValue(new Error("Agent is not configured"));

    await renderPanel();

    expect(container!.textContent).toContain("No intervention needed");
    expect(container!.textContent).toContain("No analysis recorded yet.");
    expect(container!.textContent).not.toContain("state unavailable");
  });

  it("re-analyzes the current assistant message and disables the control while generation is busy", async () => {
    narrativeCraftMocks.getMemory.mockResolvedValue({ memory: { state: {} } });
    await renderPanel();

    const button = Array.from(container!.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "Re-analyze now",
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(narrativeCraftMocks.retryAgents).toHaveBeenCalledWith("chat-1", ["narrative-craft"], {
      forMessageId: "assistant-1",
    });

    act(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <NarrativeCraftPanel
            chatId="chat-1"
            messages={[{ id: "assistant-1", chatId: "chat-1", role: "assistant", content: "Reply" } as never]}
            isGenerationBusy
          />
        </QueryClientProvider>,
      );
    });
    expect(button!.disabled).toBe(true);
  });

  it("clears current and legacy craft memory after confirmation", async () => {
    narrativeCraftMocks.getMemory.mockResolvedValue({ memory: { state: {} } });
    await renderPanel();

    const button = Array.from(container!.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "Clear craft state",
    );
    await act(async () => {
      button!.click();
    });

    expect(narrativeCraftMocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Clear Narrative Craft state", tone: "destructive" }),
    );
    expect(narrativeCraftMocks.clearMemory).toHaveBeenCalledWith("narrative-craft", "chat-1");
    expect(narrativeCraftMocks.clearMemory).toHaveBeenCalledWith("secret-plot-driver", "chat-1");
  });

  it("keeps a partial clear visible and shows the memory block that remains", async () => {
    let currentCleared = false;
    narrativeCraftMocks.getMemory.mockImplementation(async (agentType: string) => {
      if (agentType === "narrative-craft") {
        return {
          memory: currentCleared
            ? {}
            : {
                state: {
                  unresolvedConsequences: ["Current consequence"],
                },
              },
        };
      }
      return {
        memory: {
          overarchingArc: "Legacy consequence",
        },
      };
    });
    narrativeCraftMocks.clearMemory.mockImplementation(async (agentType: string) => {
      if (agentType === "secret-plot-driver") throw new Error("legacy clear failed");
      currentCleared = true;
      return { deleted: true };
    });
    await renderPanel();

    const button = Array.from(container!.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "Clear craft state",
    );
    await act(async () => {
      button!.click();
    });

    expect(narrativeCraftMocks.toastError).toHaveBeenCalledWith(
      "Some saved craft state could not be cleared. Reloaded the remaining state.",
    );
    expect(container!.textContent).toContain("Secret Plot memory could not be cleared.");
    expect(container!.textContent).toContain("Retry clear");
    expect(container!.textContent).toContain("Legacy consequence");
    expect(container!.textContent).not.toContain("Current consequence");
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

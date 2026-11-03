import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../shared/stores/ui.store";
import { ConnectionEditor } from "./ConnectionEditor";

const { idle } = vi.hoisted(() => ({
  idle: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined) }),
}));

vi.mock("../../../catalog/connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../catalog/connections")>();
  return {
    ...actual,
    useConnection: () => ({
      data: { id: "conn-1", name: "OpenRouter", provider: "openrouter", model: "", baseUrl: "", hasApiKey: false },
      isLoading: false,
    }),
    useConnections: () => ({ data: [] }),
    useUpdateConnection: idle,
    useDeleteConnection: idle,
    useTestConnection: idle,
    useTestMessage: idle,
    useTestImageGeneration: idle,
    useDiagnoseClaudeSubscription: idle,
    useFetchModels: idle,
    useSaveConnectionDefaults: idle,
    useRefreshConnection: () => vi.fn(),
  };
});

vi.mock("../../../catalog/presets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../catalog/presets")>();
  return { ...actual, usePresets: () => ({ data: [] }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  useUIStore.getState().closeConnectionDetail();
});

function renderEditor(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => useUIStore.getState().openConnectionDetail("conn-1"));
  act(() => root!.render(<ConnectionEditor />));
  return host;
}

describe("ConnectionEditor header", () => {
  it("keeps the Save label visible on phones instead of leaving an unlabeled icon", () => {
    const container = renderEditor();
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save");

    expect(save, "Save button with a text label").toBeDefined();
    const label = [...save!.querySelectorAll("span")].find((span) => span.textContent === "Save");
    expect(label?.className ?? "").not.toContain("max-md:hidden");
  });

  it("names the delete icon for screen readers", () => {
    const container = renderEditor();

    expect(container.querySelector('button[aria-label="Delete connection"]')).not.toBeNull();
  });

  // Beside the chat list and Connections panel the editor pane is ~300px even on a 1024px window, where a 4-column
  // grid sized from the window width cut 10 of 13 provider names to "Open…", "Anthr…". jsdom has no layout, so this
  // pins the two things that fixed it: columns from the grid's own width, and names that wrap instead of truncating.
  it("sizes provider columns from the editor's width and wraps long names instead of cutting them off", () => {
    const container = renderEditor();
    const providerButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Custom (OAI-Compatible)",
    );
    expect(providerButton, "provider option").toBeDefined();
    const grid = providerButton!.parentElement!;

    expect(grid.className).toContain("grid-cols-[repeat(auto-fill,");
    expect(grid.className).not.toMatch(/\b(sm|md|lg):grid-cols-/);
    for (const option of grid.querySelectorAll("button")) {
      expect(option.className.split(/\s+/)).not.toContain("truncate");
    }
  });
});

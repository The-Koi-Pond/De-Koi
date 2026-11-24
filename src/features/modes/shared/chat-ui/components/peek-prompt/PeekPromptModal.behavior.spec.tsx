// Pins old-viewer behavior and styles found by independent checks after the recordings (differential fuzzing and
// real-Chrome computed styles), beyond what the recorded scenarios cover.
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeekPromptData } from "../../types";

vi.mock("../../../../../catalog/presets/index", () => ({
  usePresetSummaries: () => ({ data: [] }),
}));

import { PeekPromptModal } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Boundary extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const SECTIONS: PeekPromptData = {
  messages: [
    { role: "system", content: "<system_prompt>\nYou are Wren.\n</system_prompt>", contextKind: "prompt" },
    { role: "user", content: "Hi there", contextKind: "history" },
  ],
  parameters: null,
};

const budget = (overrides: Record<string, unknown>) =>
  ({
    contextLimit: 1000,
    estimatedPromptTokens: 400,
    outputReserveTokens: 100,
    safetyReserveTokens: 50,
    inputBudgetTokens: 850,
    remainingTokens: 450,
    sections: [],
    warnings: [],
    softLimitTokens: null,
    softLimitFallbackUsed: false,
    ...overrides,
  }) as never;

describe("PeekPromptModal old-viewer details", () => {
  let container: HTMLDivElement;
  let root: Root;
  let errors: unknown[];
  let consoleError: ReturnType<typeof vi.spyOn>;

  const render = (data: unknown) =>
    act(() =>
      root.render(
        <Boundary onError={(e) => errors.push(e)}>
          <PeekPromptModal data={data as PeekPromptData} onClose={() => {}} />
        </Boundary>,
      ),
    );
  const text = () => norm(container.textContent);
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')!;
  const toggles = () =>
    [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") !== "Close");

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    errors = [];
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  describe("data handling", () => {
    it("falls back to the message estimate when the budget has no estimate (5)", () => {
      render({
        messages: [{ role: "system", content: "abcdefg" }],
        parameters: null,
        error: "Boom",
        budget: budget({ estimatedPromptTokens: null }),
      });
      expect(errors).toEqual([]);
      expect(text()).toContain("1 section · ~2 tokens");
      expect(text()).toContain("Boom");
    });

    it("builds the blocks while loading, so malformed data throws then too (6)", () => {
      render({ messages: null, parameters: null, loading: true });
      expect(errors).toHaveLength(1);
    });

    it("uses any preview messages that have a length, so a string preview throws (7)", () => {
      render({ messages: [], previewMessages: "abc", parameters: null });
      expect(errors).toHaveLength(1);
    });

    it("treats a truthy `exact` as an exact request (8)", () => {
      render({ ...SECTIONS, exact: 1 });
      expect(text()).toContain("Exact Text Model Request");
    });

    it("uses `error` itself as the JSX condition: 0 renders a stray 0 and the normal content (8)", () => {
      render({ ...SECTIONS, error: 0 });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(text()).toMatch(/~\d+ tokens0System Prompt/);
      expect(toggles()).toHaveLength(2);
    });

    it("shows the provider prefix only for a truthy provider (8)", () => {
      render({ ...SECTIONS, generationInfo: { model: "gpt-test", provider: 0 } });
      expect(text()).toContain("gpt-test~");
      expect(text()).not.toContain("0 / gpt-test");
      expect(text()).not.toContain("0gpt-test");
    });

    it("renders generation info text settings as raw React children (9)", () => {
      render({ ...SECTIONS, generationInfo: { reasoningEffort: ["low", "mid"], verbosity: true } });
      expect(text()).toContain("Reasoninglowmid");
      // The pill and its label both read "Verbosity": the value next to the label is empty.
      const verbosity = [...container.querySelectorAll("span")].filter((el) => el.textContent === "Verbosity").at(-1);
      expect(verbosity?.nextElementSibling?.textContent).toBe("");
      expect(errors).toEqual([]);

      render({ ...SECTIONS, generationInfo: { serviceTier: { tier: "x" } } });
      expect(errors).toHaveLength(1);
    });

    it("keeps String() for parameter pills (9)", () => {
      render({ ...SECTIONS, parameters: { reasoningEffort: ["low", "mid"] } });
      expect(text()).toContain("Reasoninglow,mid");
    });

    it("keys budget section rows by kind, so duplicate kinds are duplicate React keys (10)", () => {
      render({
        ...SECTIONS,
        budget: budget({
          sections: [
            { kind: "lorebook", label: "Lore A", estimatedTokens: 10, messageCount: 1, trimRisk: "none" },
            { kind: "lorebook", label: "Lore B", estimatedTokens: 20, messageCount: 1, trimRisk: "none" },
          ],
        }),
      });
      expect(text()).toContain("Lore A~10Lore B~20");
      const duplicateKey = consoleError.mock.calls.some((call: unknown[]) => String(call[0]).includes("same key"));
      expect(duplicateKey).toBe(true);
    });

    it("stops clicks inside the dialog from propagating past it (11)", () => {
      render(SECTIONS);
      const outside = vi.fn();
      document.addEventListener("click", outside);
      try {
        act(() => dialog().querySelector("h3")!.click());
        expect(outside).not.toHaveBeenCalled();
        act(() => (container.firstElementChild as HTMLElement).click());
        expect(outside).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("click", outside);
      }
    });
  });

  describe("styles", () => {
    const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);

    it("keeps leading-relaxed on opened block text, with no font-mono (12)", () => {
      render(SECTIONS);
      act(() => toggles()[0]!.click());
      act(() => toggles()[1]!.click());
      act(() => toggles()[2]!.click());
      const [sectionPre, entryPre] = [...container.querySelectorAll("pre")];
      expect(classes(sectionPre)).toEqual(expect.arrayContaining(["text-xs", "leading-relaxed"]));
      expect(classes(entryPre)).toEqual(expect.arrayContaining(["text-[0.6875rem]", "leading-relaxed"]));
      expect(classes(sectionPre)).not.toContain("font-mono");
      expect(classes(entryPre)).not.toContain("font-mono");
    });

    it("gives attribution item rows min-width 0 (13)", () => {
      render({
        ...SECTIONS,
        contextAttribution: {
          source: "saved_snapshot",
          items: [{ kind: "lorebook", label: "Bell", status: "injected", snippet: "Rings." }],
        },
      });
      const label = [...container.querySelectorAll("span")].find((el) => el.textContent === "Bell")!;
      expect(classes(label.parentElement)).toContain("min-w-0");
      expect(classes(label.parentElement!.parentElement)).toContain("min-w-0");
    });

    it("uses a 1.5rem loading spinner (14)", () => {
      render({ messages: [], parameters: null, loading: true });
      expect(classes(container.querySelector("svg.animate-spin"))).toEqual(expect.arrayContaining(["h-6", "w-6"]));
    });

    it("doesn't uppercase the trim risk tag (15)", () => {
      render({
        ...SECTIONS,
        budget: budget({
          sections: [{ kind: "history", label: "History", estimatedTokens: 10, messageCount: 1, trimRisk: "high" }],
        }),
      });
      const tag = [...container.querySelectorAll("span")].find((el) => el.textContent === "trim risk");
      expect(tag).toBeDefined();
      expect(classes(tag)).not.toContain("uppercase");
    });

    it("spaces the settings panel's children instead of a bottom margin on its first line (16)", () => {
      render({ ...SECTIONS, generationInfo: { model: "gpt-test" } });
      const model = [...container.querySelectorAll("span")].find((el) => el.textContent === "gpt-test")!;
      const firstLine = model.parentElement!;
      expect(classes(firstLine.parentElement)).toContain("space-y-2");
      expect(classes(firstLine).some((c) => c.startsWith("mb-"))).toBe(false);
      expect(firstLine.nextElementSibling).toBeNull();
    });

    it("rounds the dialog with rounded-2xl (17)", () => {
      render(SECTIONS);
      expect(classes(dialog())).toContain("rounded-2xl");
    });
  });
});

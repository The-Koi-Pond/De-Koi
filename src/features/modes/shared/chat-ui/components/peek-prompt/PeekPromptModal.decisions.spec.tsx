import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeekPromptData } from "../../types";

vi.mock("../../../../../catalog/presets/index", () => ({
  usePresetSummaries: () => ({ data: [] }),
}));

import { PeekPromptModal } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA: PeekPromptData = {
  messages: [
    { role: "system", content: "<system_prompt>\nYou are Wren.\n</system_prompt>", contextKind: "prompt" },
    { role: "user", content: "Hi", contextKind: "history" },
    { role: "assistant", content: "Hello.", contextKind: "history" },
  ],
  parameters: null,
  budget: {
    contextLimit: 1000,
    estimatedPromptTokens: 400,
    outputReserveTokens: 100,
    safetyReserveTokens: 50,
    inputBudgetTokens: 850,
    remainingTokens: 450,
    sections: [{ kind: "preset", label: "Preset", estimatedTokens: 400, messageCount: 1, trimRisk: "none" }],
    warnings: [{ kind: "near_limit", message: "Close to the limit." }],
    softLimitTokens: null,
    softLimitFallbackUsed: false,
  },
};

describe("PeekPromptModal spec decisions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  const render = (data: PeekPromptData) => act(() => root.render(<PeekPromptModal data={data} onClose={onClose} />));
  const backdrop = () => container.firstElementChild as HTMLElement;
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')!;
  const toggles = () =>
    [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") !== "Close");
  const fire = (el: Element, type: string) =>
    act(() => {
      el.dispatchEvent(
        typeof PointerEvent === "function" && type.startsWith("pointer")
          ? new PointerEvent(type, { bubbles: true, cancelable: true })
          : new MouseEvent(type, { bubbles: true, cancelable: true }),
      );
    });
  const press = (el: Element) => {
    fire(el, "pointerdown");
    fire(el, "mousedown");
  };
  const release = (el: Element) => {
    fire(el, "pointerup");
    fire(el, "mouseup");
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onClose = vi.fn<() => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  describe("1. toggles", () => {
    it("makes every block, chat history and entry header a type=button with aria-expanded", () => {
      render(DATA);
      const [section, history] = toggles();
      expect(toggles()).toHaveLength(2);
      for (const button of toggles()) {
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-expanded")).toBe("false");
      }

      act(() => section!.click());
      expect(section!.getAttribute("aria-expanded")).toBe("true");

      act(() => history!.click());
      expect(history!.getAttribute("aria-expanded")).toBe("true");
      const entries = toggles().slice(2);
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.getAttribute("type")).toBe("button");
        expect(entry.getAttribute("aria-expanded")).toBe("false");
      }
      act(() => entries[0]!.click());
      expect(entries[0]!.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("2. hidden decoration", () => {
    it("hides every icon and both kinds of budget bar from assistive tech", () => {
      render(DATA);
      act(() => toggles()[1]!.click());
      const icons = [...container.querySelectorAll("svg")];
      expect(icons.length).toBeGreaterThan(4);
      for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");

      const bars = [...container.querySelectorAll<HTMLElement>("[style]")].map((fill) => fill.parentElement!);
      expect(bars).toHaveLength(2);
      for (const bar of bars) expect(bar.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("3. states", () => {
    it("names the loading area as a status", () => {
      render({ messages: [], parameters: null, loading: true });
      const status = container.querySelector('[role="status"]');
      expect(status?.getAttribute("aria-label")).toBe("Assembling prompt");
      expect(status?.querySelector("svg.animate-spin")).not.toBeNull();
    });

    it("announces the error box as an alert", () => {
      render({ messages: [], parameters: null, error: "Could not assemble prompt." });
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not assemble prompt.");
      expect(container.querySelector('[role="status"]')).toBeNull();
    });
  });

  describe("4. backdrop", () => {
    it("closes when the press and the release are both on the backdrop", () => {
      render(DATA);
      press(backdrop());
      release(backdrop());
      act(() => backdrop().click());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("stays open when the press starts inside the dialog and the release and click land on the backdrop", () => {
      render(DATA);
      const heading = dialog().querySelector("h3")!;
      press(heading);
      release(backdrop());
      act(() => backdrop().click());
      expect(onClose).not.toHaveBeenCalled();
    });

    it("stays open when the press is on the backdrop and the release is inside the dialog", () => {
      render(DATA);
      press(backdrop());
      release(dialog());
      // The browser sends the click to the nearest common ancestor: the backdrop.
      act(() => backdrop().click());
      expect(onClose).not.toHaveBeenCalled();
    });

    it("stays open for a bare click with no press, and the next full click still closes", () => {
      render(DATA);
      act(() => backdrop().click());
      expect(onClose).not.toHaveBeenCalled();
      press(backdrop());
      release(backdrop());
      act(() => backdrop().click());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("never closes for clicks inside the dialog", () => {
      render(DATA);
      press(dialog());
      release(dialog());
      act(() => dialog().click());
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

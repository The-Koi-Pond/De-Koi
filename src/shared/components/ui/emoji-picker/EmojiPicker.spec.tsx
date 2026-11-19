import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmojiPicker } from "./index";
import recorded from "./test-fixtures/recorded-picker.json";

type Rect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height" | "x" | "y">;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function elementAt(rect: Rect | null): HTMLElement {
  const element = document.createElement("button");
  document.body.appendChild(element);
  if (rect) vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  return element;
}

function refTo(element: HTMLElement): RefObject<HTMLElement | null> {
  const ref = createRef<HTMLElement | null>();
  ref.current = element;
  return ref;
}

interface RenderProps {
  open?: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  containerRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** React drag handlers on an element around the picker, like the message bar's file drop. */
  parentDrag?: { onDragEnter: () => void; onDragOver: () => void; onDragLeave: () => void; onDrop: () => void };
}

const onClose = vi.fn();
const onSelect = vi.fn();

function render({ open = true, anchorRef, containerRef, returnFocusRef, parentDrag }: RenderProps = {}) {
  act(() => {
    root ??= createRoot(host!);
    const picker = (
      <EmojiPicker
        open={open}
        onClose={onClose}
        onSelect={onSelect}
        anchorRef={anchorRef}
        containerRef={containerRef}
        returnFocusRef={returnFocusRef}
      />
    );
    root.render(parentDrag ? <div {...parentDrag}>{picker}</div> : picker);
  });
}

/** The panel's rendered height; jsdom lays nothing out, so tests set it. */
function mockPanelHeight(height: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "dialog") {
      return { top: 0, right: 336, bottom: height, left: 0, width: 336, height, x: 0, y: 0 } as DOMRect;
    }
    return original.call(this);
  });
}

function panel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function searchBox(): HTMLInputElement {
  return panel()!.querySelector<HTMLInputElement>("input")!;
}

function tab(label: string): HTMLButtonElement {
  return panel()!.querySelector<HTMLButtonElement>(`button[title="${label}"]`)!;
}

/** What the grid shows: each heading with its emoji buttons' text, in order. */
function grid() {
  return [...panel()!.querySelectorAll("section")].map((section) => ({
    heading: section.querySelector("h3")!.textContent,
    emojis: [...section.querySelectorAll("button")].map((button) => button.textContent),
  }));
}

function type(value: string) {
  const input = searchBox();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function press(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

/** The scrolling grid: the panel's last child. */
function scroller(): HTMLElement {
  return panel()!.lastElementChild as HTMLElement;
}

function keyDown(init: KeyboardEventInit) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

function emojiButton(emoji: string): HTMLButtonElement {
  return [...panel()!.querySelectorAll<HTMLButtonElement>("section button")].find(
    (button) => button.textContent === emoji,
  )!;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onClose.mockReset();
  onSelect.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
  setWindowSize(originalSize.width, originalSize.height);
  vi.restoreAllMocks();
});

describe("EmojiPicker", () => {
  it("renders nothing while closed", () => {
    render({ open: false });
    expect(panel()).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("opens in a portal on document.body with the search box focused and Smileys showing", () => {
    render();
    expect(panel()!.parentElement).toBe(document.body);
    expect(host!.childElementCount).toBe(0);
    expect(document.activeElement).toBe(searchBox());
    expect(searchBox().placeholder).toBe(recorded.initial.searchFocused);
    expect(grid()).toEqual(recorded.initial.grid);
    expect(panel()!.className).toContain("fixed");
  });

  it("shows each tab's category alone, as recorded, with in-category repeats removed", () => {
    render();
    for (const category of recorded.categories) {
      const button = tab(category.title);
      expect(button.textContent).toBe(category.icon);
      click(button);
      expect(grid()).toEqual(
        category.grid.map((section) => ({ heading: section.heading, emojis: [...new Set(section.emojis)] })),
      );
    }
  });

  it("shows search results under category headings, keeping the recorded headings", () => {
    render();
    type(recorded.tabsWhileSearching.conversation.query);
    const headings = grid().map((section) => section.heading);
    expect(headings).toEqual(expect.arrayContaining(recorded.tabsWhileSearching.conversation.headings));
    expect(grid().find((section) => section.heading === "Hearts")!.emojis).toContain("❤️");
  });

  describe("position", () => {
    const measured = recorded.positions.filter((entry) => entry.smileyVisible);

    it.each(measured.map((entry) => [entry.kind, entry.viewport.width, entry.viewport.height, entry] as const))(
      "%s caller at %ix%i matches the recorded bottom, left and right",
      (_kind, width, height, entry) => {
        setWindowSize(width, height);
        const recordedBottom = Number.parseFloat(entry.panel!.bottom);
        // The bar's top edge sits 8px below the panel's recorded bottom edge.
        const barTop = height - recordedBottom + 8;
        const anchor = elementAt(entry.anchor!);
        const bar = elementAt({ ...entry.anchor!, top: barTop, y: barTop });
        render({ anchorRef: refTo(anchor), containerRef: refTo(bar) });

        const style = panel()!.style;
        expect(Number.parseFloat(style.bottom)).toBeCloseTo(recordedBottom, 2);
        expect(Number.parseFloat(style.right)).toBeCloseTo(Number.parseFloat(entry.panel!.right), 2);
        expect(style.left).toBe(entry.panel!.left);
        expect(entry.panel!.rect.bottom).toBeCloseTo(height - recordedBottom, 2);
      },
    );

    it("uses the anchor's top edge when there is no container", () => {
      setWindowSize(1366, 900);
      const anchor = elementAt(measured[0].anchor!);
      render({ anchorRef: refTo(anchor) });
      expect(Number.parseFloat(panel()!.style.bottom)).toBeCloseTo(900 - measured[0].anchor!.top + 8, 3);
    });

    it.each([
      [412, 38],
      [320, 8],
      [479, 71.5],
    ])("centers the panel in a %ipx-wide window (left %s)", (width, left) => {
      setWindowSize(width, 915);
      const anchor = elementAt({
        top: 860,
        right: width - 20,
        bottom: 894,
        left: width - 54,
        width: 34,
        height: 34,
        x: 0,
        y: 860,
      });
      const bar = elementAt({ top: 850, right: width, bottom: 915, left: 0, width, height: 65, x: 0, y: 850 });
      render({ anchorRef: refTo(anchor), containerRef: refTo(bar) });
      expect(panel()!.style.left).toBe(`${left}px`);
      expect(panel()!.style.right).toBe("");
      expect(panel()!.style.bottom).toBe(`${915 - 850 + 8}px`);
    });

    describe("short windows keep the top on screen", () => {
      function openAboveBarAt(windowHeight: number, barTop: number) {
        setWindowSize(1366, windowHeight);
        const anchor = elementAt({
          top: barTop + 10,
          right: 1000,
          bottom: barTop + 44,
          left: 966,
          width: 34,
          height: 34,
          x: 966,
          y: barTop + 10,
        });
        const bar = elementAt({
          top: barTop,
          right: 1366,
          bottom: windowHeight,
          left: 0,
          width: 1366,
          height: windowHeight - barTop,
          x: 0,
          y: barTop,
        });
        mockPanelHeight(352);
        render({ anchorRef: refTo(anchor), containerRef: refTo(bar) });
        return panel()!.style;
      }

      it("stays above the bar while the whole panel fits with 8px to spare", () => {
        // 368 = 8px above the panel + 352 panel + 8px between the panel and the bar.
        const style = openAboveBarAt(500, 368);
        expect(style.bottom).toBe(`${500 - 368 + 8}px`);
        expect(style.top).toBe("");
        expect(style.height).toBe("");
        expect(style.right).toBe(`${1366 - 1000}px`);
      });

      it("pins the top 8px below the window's top edge, covering the bar, when there isn't room above it", () => {
        const style = openAboveBarAt(500, 300);
        expect(style.top).toBe("8px");
        expect(style.bottom).toBe("");
        expect(style.height).toBe("352px");
        expect(style.right).toBe(`${1366 - 1000}px`);
      });

      it("shrinks to the window, 8px from each edge, when the window is shorter than the panel", () => {
        const style = openAboveBarAt(300, 230);
        expect(style.top).toBe("8px");
        expect(style.height).toBe(`${300 - 16}px`);
      });
    });

    it("sits at the bottom-left corner when there is no anchor", () => {
      render();
      expect(panel()!.style.bottom).toBe("0px");
      expect(panel()!.style.left).toBe("0px");
    });
  });

  describe("picking and closing", () => {
    it("hands over the exact emoji, variation selector included, and stays open", () => {
      render();
      click(emojiButton("😀"));
      click(emojiButton("😃"));
      click(tab("Hearts"));
      click(emojiButton("❤️"));
      expect(onSelect.mock.calls).toEqual([["😀"], ["😃"], ["❤️"]]);
      expect(onClose).not.toHaveBeenCalled();
      expect(panel()).not.toBeNull();
    });

    it("closes on Escape anywhere in the page", () => {
      render();
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores Escape while an input method is composing", () => {
      render();
      keyDown({ key: "Escape", isComposing: true });
      keyDown({ key: "Escape", keyCode: 229 });
      expect(onClose).not.toHaveBeenCalled();
      keyDown({ key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on a press outside, but not on a press inside the panel or on the anchor", () => {
      const anchor = elementAt(null);
      const outside = elementAt(null);
      render({ anchorRef: refTo(anchor) });
      press(searchBox());
      press(emojiButton("😀"));
      press(anchor);
      expect(onClose).not.toHaveBeenCalled();
      press(outside);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("gives focus back to the message box after Escape", () => {
      const messageBox = document.createElement("textarea");
      document.body.appendChild(messageBox);
      render({ returnFocusRef: refTo(messageBox) });
      expect(document.activeElement).toBe(searchBox());
      keyDown({ key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(messageBox);
    });

    it("gives focus back to the message box after an outside press that leaves focus on the page", () => {
      vi.useFakeTimers();
      try {
        const messageBox = document.createElement("textarea");
        const outside = document.createElement("div");
        document.body.append(messageBox, outside);
        render({ returnFocusRef: refTo(messageBox) });
        press(outside);
        expect(onClose).toHaveBeenCalledTimes(1);
        // The caller closes it; the focused search box goes with the panel.
        render({ open: false, returnFocusRef: refTo(messageBox) });
        expect(document.activeElement).toBe(document.body);
        act(() => vi.runAllTimers());
        expect(document.activeElement).toBe(messageBox);
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves focus where an outside press put it", () => {
      vi.useFakeTimers();
      try {
        const messageBox = document.createElement("textarea");
        const otherField = document.createElement("input");
        document.body.append(messageBox, otherField);
        render({ returnFocusRef: refTo(messageBox) });
        press(otherField);
        render({ open: false, returnFocusRef: refTo(messageBox) });
        // In a browser the press itself focuses the field it lands on.
        otherField.focus();
        act(() => vi.runAllTimers());
        expect(document.activeElement).toBe(otherField);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops listening once closed", () => {
      render();
      render({ open: false });
      press(document.body);
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("drag and drop", () => {
    function drag(element: Element, type: string) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const dataTransfer = { dropEffect: "copy", files: [] };
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      act(() => {
        element.dispatchEvent(event);
      });
      return { event, dataTransfer };
    }

    it("keeps drags over the picker from the message bar's file drop, and refuses the drop", () => {
      const parentDrag = { onDragEnter: vi.fn(), onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() };
      render({ parentDrag });
      for (const target of [panel()!, emojiButton("😀"), searchBox()]) {
        for (const type of ["dragenter", "dragover", "drop"]) {
          const { event, dataTransfer } = drag(target, type);
          // Handled here, so the browser doesn't open a dropped file either.
          expect(event.defaultPrevented).toBe(true);
          expect(dataTransfer.dropEffect).toBe("none");
        }
        drag(target, "dragleave");
      }
      expect(parentDrag.onDragEnter).not.toHaveBeenCalled();
      expect(parentDrag.onDragOver).not.toHaveBeenCalled();
      expect(parentDrag.onDragLeave).not.toHaveBeenCalled();
      expect(parentDrag.onDrop).not.toHaveBeenCalled();
    });

    it("still lets the same handlers see drags outside the picker", () => {
      const parentDrag = { onDragEnter: vi.fn(), onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() };
      render({ parentDrag });
      drag(host!.firstElementChild!, "dragover");
      drag(host!.firstElementChild!, "drop");
      expect(parentDrag.onDragOver).toHaveBeenCalledTimes(1);
      expect(parentDrag.onDrop).toHaveBeenCalledTimes(1);
    });
  });

  describe("grid scroll", () => {
    it("starts at the top after a tab click", () => {
      render();
      click(tab("Symbols"));
      const grid = scroller();
      grid.scrollTop = 500;
      click(tab("Food"));
      expect(scroller()).toBe(grid);
      expect(grid.scrollTop).toBe(0);
    });

    it("starts at the top when the search changes, and keeps its place for padding-only edits", () => {
      render();
      const grid = scroller();
      grid.scrollTop = 300;
      type("face");
      expect(grid.scrollTop).toBe(0);
      grid.scrollTop = 200;
      type("face ");
      expect(grid.scrollTop).toBe(200);
      type("");
      expect(grid.scrollTop).toBe(0);
    });
  });

  describe("decisions", () => {
    it("4: says so when nothing matches", () => {
      render();
      type("xyzzy");
      expect(grid()).toEqual([]);
      expect(panel()!.textContent).toContain("No emojis found");
    });

    it("5: reopening starts with an empty search and keeps the last category", () => {
      render();
      type(recorded.reopen.conversation.afterQuery.query);
      expect(grid().map((section) => section.heading)).toEqual(
        expect.arrayContaining(recorded.reopen.conversation.afterQuery.headings),
      );
      render({ open: false });
      render();
      expect(searchBox().value).toBe("");
      expect(grid().map((section) => section.heading)).toEqual(["Smileys"]);

      click(tab("Food"));
      render({ open: false });
      render();
      expect(grid().map((section) => section.heading)).toEqual(recorded.reopen.conversation.afterTab.headings);
      expect(tab("Food").getAttribute("aria-pressed")).toBe("true");
    });

    it("6: a tab click while searching clears the search and shows that category", () => {
      render();
      type(recorded.tabsWhileSearching.conversation.query);
      expect(grid().length).toBeGreaterThan(1);
      click(tab("Food"));
      expect(searchBox().value).toBe("");
      expect(grid().map((section) => section.heading)).toEqual(["Food"]);
    });

    it("7: a press outside closes the picker even without an anchor", () => {
      render();
      press(panel()!);
      expect(onClose).not.toHaveBeenCalled();
      press(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("8: names the dialog, search box, tabs and emojis, and every button is type=button", () => {
      render();
      const dialog = panel()!;
      expect(dialog.getAttribute("aria-label")).toBe("Emoji picker");
      expect(dialog.getAttribute("aria-modal")).toBeNull();
      expect(searchBox().getAttribute("aria-label")).toBe("Search emojis");
      for (const category of recorded.categories) {
        const button = tab(category.title);
        expect(button.getAttribute("aria-label")).toBe(category.title);
        expect(button.getAttribute("aria-pressed")).toBe(category.title === "Smileys" ? "true" : "false");
      }
      expect(emojiButton("😀").getAttribute("aria-label")).toBe("grinning face");
      for (const button of dialog.querySelectorAll("button")) {
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBeTruthy();
      }
    });
  });
});

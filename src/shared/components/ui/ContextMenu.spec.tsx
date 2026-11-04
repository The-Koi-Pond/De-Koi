import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function Harness({ onPick }: { onPick: (label: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" aria-haspopup="menu" onClick={() => setOpen(true)}>
          Open
        </button>
        {open && (
          <ContextMenu
            x={0}
            y={0}
            onClose={() => setOpen(false)}
            items={[
              { label: "First", onSelect: () => onPick("First") },
              { label: "Off", onSelect: () => onPick("Off"), disabled: true },
              { label: "Last", onSelect: () => onPick("Last") },
            ]}
          />
        )}
      </>
    );
  }

  function openMenu(onPick = vi.fn()) {
    act(() => root.render(<Harness onPick={onPick} />));
    const trigger = container.querySelector("button")!;
    trigger.focus();
    act(() => trigger.click());
    return trigger;
  }

  function press(key: string) {
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  const focusedLabel = () => document.activeElement?.textContent;

  it("focuses the first item and moves between enabled items with the arrow keys", () => {
    openMenu();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(focusedLabel()).toBe("First");

    press("ArrowDown");
    expect(focusedLabel()).toBe("Last");
    press("ArrowDown");
    expect(focusedLabel()).toBe("First");
    press("ArrowUp");
    expect(focusedLabel()).toBe("Last");
    press("Home");
    expect(focusedLabel()).toBe("First");
    press("End");
    expect(focusedLabel()).toBe("Last");
  });

  it("closes on Escape and hands focus back to the button that opened it", () => {
    const trigger = openMenu();
    press("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus after an item is picked", () => {
    const onPick = vi.fn();
    const trigger = openMenu(onPick);
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onPick).toHaveBeenCalledWith("First");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

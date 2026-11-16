import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogRowAction } from "./CatalogPanelControls";
import { CatalogRowActionsMenu } from "./CatalogRowActionsMenu";

describe("CatalogRowActionsMenu", () => {
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

  // The menu is portalled to <body>, but React bubbles its clicks to the row. A pick must run the
  // row button's own handler and must not also reach the row (which opens the chat).
  it("runs the picked action through its row button without opening the row", () => {
    const onRow = vi.fn();
    const onPin = vi.fn();
    const onDelete = vi.fn();
    const actions: CatalogRowAction[] = [
      { key: "pin", title: "Pin chat", label: "Pin Wren", icon: null, className: "", onClick: onPin },
      { key: "delete", title: "Delete chat", label: "Delete Wren", icon: null, className: "", onClick: onDelete },
    ];

    function Row() {
      const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
      return (
        <div onClick={onRow}>
          {actions.map((action, index) => (
            <button
              key={action.key}
              type="button"
              hidden
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick(event);
              }}
            >
              {action.title}
            </button>
          ))}
          <CatalogRowActionsMenu actions={actions} buttonRefs={buttonRefs} />
        </div>
      );
    }

    act(() => root.render(<Row />));
    const more = container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    act(() => more.click());

    const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Pin chat", "Delete chat"]);
    expect(items[1]!.className).toContain("--destructive");

    act(() => items[0]!.click());

    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onRow).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});

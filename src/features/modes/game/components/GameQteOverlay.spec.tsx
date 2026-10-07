import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameQteOverlay } from "./GameQteOverlay";

describe("GameQteOverlay keyboard", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("picks the action whose number key is pressed", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <GameQteOverlay
          actions={[{ label: "Duck" }, { label: "Run" }]}
          timerSeconds={6}
          onSelect={onSelect}
          onTimeout={vi.fn()}
        />,
      ),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
      vi.advanceTimersByTime(500);
    });
    expect(onSelect).toHaveBeenCalledWith("Run", expect.any(Number));
  });

  it("ignores number keys aimed at a form control or editable region", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <>
          <input data-testid="field" />
          <select aria-label="pick">
            <option>1</option>
          </select>
          <div contentEditable="" suppressContentEditableWarning />
          <GameQteOverlay actions={[{ label: "Duck" }]} timerSeconds={6} onSelect={onSelect} onTimeout={vi.fn()} />
        </>,
      ),
    );
    act(() => {
      for (const selector of ["input", "select", "[contenteditable]"]) {
        host.querySelector(selector)!.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
      }
      vi.advanceTimersByTime(500);
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

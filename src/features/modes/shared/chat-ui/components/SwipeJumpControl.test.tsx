// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwipeJumpControl } from "./SwipeJumpControl";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SwipeJumpControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function buttons() {
    return Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  }

  it("moves to the next existing swipe before the end", () => {
    const onSetActiveSwipe = vi.fn();
    const onCreateNextSwipe = vi.fn();

    act(() => {
      root.render(
        <SwipeJumpControl
          activeSwipeIndex={0}
          swipeCount={2}
          onSetActiveSwipe={onSetActiveSwipe}
          onCreateNextSwipe={onCreateNextSwipe}
        />,
      );
    });

    act(() => {
      buttons()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSetActiveSwipe).toHaveBeenCalledWith(1);
    expect(onCreateNextSwipe).not.toHaveBeenCalled();
  });

  it("uses the last-swipe next arrow to create a new swipe", () => {
    const onSetActiveSwipe = vi.fn();
    const onCreateNextSwipe = vi.fn();

    act(() => {
      root.render(
        <SwipeJumpControl
          activeSwipeIndex={1}
          swipeCount={2}
          onSetActiveSwipe={onSetActiveSwipe}
          onCreateNextSwipe={onCreateNextSwipe}
        />,
      );
    });

    const nextButton = buttons()[1]!;
    expect(nextButton.disabled).toBe(false);

    act(() => {
      nextButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCreateNextSwipe).toHaveBeenCalledTimes(1);
    expect(onSetActiveSwipe).not.toHaveBeenCalled();
  });

  it("keeps the last-swipe next arrow disabled without a creation handler", () => {
    act(() => {
      root.render(<SwipeJumpControl activeSwipeIndex={1} swipeCount={2} onSetActiveSwipe={vi.fn()} />);
    });

    expect(buttons()[1]!.disabled).toBe(true);
  });
});

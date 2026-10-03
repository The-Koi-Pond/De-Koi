import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePresence } from "./use-presence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounts: string[] = [];

function Item({ id, exiting }: { id: string; exiting: boolean }) {
  useEffect(() => {
    mounts.push(id);
  }, [id]);
  return <li data-id={id} data-exiting={exiting ? "yes" : "no"} />;
}

function List({ items, mode }: { items: string[]; mode?: "sync" | "wait" }) {
  const entries = usePresence(items, (item) => item, 200, mode);
  return (
    <ul>
      {entries.map(({ key, item, exiting }) => (
        <Item key={key} id={item} exiting={exiting} />
      ))}
    </ul>
  );
}

describe("usePresence", () => {
  let container: HTMLDivElement;
  let root: Root;

  const rendered = () =>
    [...container.querySelectorAll("li")].map((li) => `${li.dataset.id}${li.dataset.exiting === "yes" ? "*" : ""}`);
  const render = (items: string[], mode?: "sync" | "wait") =>
    act(() => root.render(<List items={items} mode={mode} />));

  beforeEach(() => {
    vi.useFakeTimers();
    mounts.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps a removed item in its place while it exits, then drops it", () => {
    render(["a", "b", "c"]);
    render(["a", "c"]);

    expect(rendered()).toEqual(["a", "b*", "c"]);
    act(() => vi.advanceTimersByTime(199));
    expect(rendered()).toEqual(["a", "b*", "c"]);
    act(() => vi.advanceTimersByTime(1));
    expect(rendered()).toEqual(["a", "c"]);
  });

  it("shows new items at once in sync mode", () => {
    render(["a"]);
    render(["b"]);

    expect(rendered()).toEqual(["a*", "b"]);
  });

  it("cancels the exit when an item comes back", () => {
    render(["a", "b"]);
    render(["a"]);
    render(["a", "b"]);
    act(() => vi.advanceTimersByTime(500));

    expect(rendered()).toEqual(["a", "b"]);
  });

  it("does not mount the next item until the previous one has left in wait mode", () => {
    render(["step-1"], "wait");
    render(["step-2"], "wait");

    expect(rendered()).toEqual(["step-1*"]);
    expect(mounts).toEqual(["step-1"]);

    act(() => vi.advanceTimersByTime(200));
    expect(rendered()).toEqual(["step-2"]);
    expect(mounts).toEqual(["step-1", "step-2"]);
  });

  it("does not hold the next item for an exit that reduced motion skips", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    try {
      render(["step-1"], "wait");
      render(["step-2"], "wait");
      act(() => vi.advanceTimersByTime(0));

      expect(rendered()).toEqual(["step-2"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the leaving item's own data while it exits", () => {
    function Labels({ items }: { items: Array<{ id: string; label: string }> }) {
      const entries = usePresence(items, (item) => item.id, 200, "wait");
      return <p>{entries.map(({ item }) => item.label).join(",")}</p>;
    }
    act(() => root.render(<Labels items={[{ id: "1", label: "first" }]} />));
    act(() => root.render(<Labels items={[{ id: "2", label: "second" }]} />));

    expect(container.textContent).toBe("first");
  });
});

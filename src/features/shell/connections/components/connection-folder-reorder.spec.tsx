import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveFolder } from "./connection-folder-reorder";
import { ConnectionsPanel } from "./ConnectionsPanel";

const currentDir = dirname(fileURLToPath(import.meta.url));
const LINE_ABOVE = "shadow-[inset_0_2px_0_var(--primary)]";
const LINE_BELOW = "shadow-[inset_0_-2px_0_var(--primary)]";
const reorderFolders = vi.fn();

const folders = ["a", "b", "c"].map((id, index) => ({
  id,
  name: `Folder ${id.toUpperCase()}`,
  color: "#38bdf8",
  sortOrder: index,
  collapsed: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}));

vi.mock("../../../catalog/connections", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const empty: never[] = [];
  return {
    useConnections: () => ({ data: empty, isLoading: false }),
    isSyntheticConnection: () => false,
    useDuplicateConnection: mutation,
    useDeleteConnection: mutation,
    useUploadConnectionImage: mutation,
    useUpdateConnection: mutation,
    useConnectionFolders: () => ({ data: folders }),
    useCreateConnectionFolder: mutation,
    useUpdateConnectionFolder: mutation,
    useDeleteConnectionFolder: mutation,
    useReorderConnectionFolders: () => ({ mutate: reorderFolders, mutateAsync: vi.fn(), isPending: false }),
    useMoveConnection: mutation,
  };
});
vi.mock("./LocalSidecarCard", () => ({ LocalSidecarCard: () => null }));
vi.mock("../../../shell/settings/index", () => ({ TTSConfigCard: () => null }));

describe("moveFolder", () => {
  it("moves a folder into the target's slot, shifting the folders in between once", () => {
    // Down the list: the dragged folder lands below the target.
    expect(moveFolder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveFolder(["a", "b", "c"], "b", "c")).toEqual(["a", "c", "b"]);
    expect(moveFolder(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    // Up the list: it lands above the target.
    expect(moveFolder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveFolder(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone for unknown or identical folders", () => {
    expect(moveFolder(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveFolder(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });
});

describe("ConnectionsPanel folder reordering", () => {
  let host: HTMLDivElement;
  let root: Root;
  // The folder row the pointer is over, as document.elementFromPoint would report it.
  let pointerOver: string | null = null;
  const elementFromPoint = document.elementFromPoint;

  const row = (id: string) => host.querySelector<HTMLElement>(`[data-connection-folder-id="${id}"]`)!;
  const grip = (id: string) => row(id).querySelector<HTMLElement>(".cursor-grab")!;

  const pointer = (type: string, target: EventTarget, pointerType = "mouse") => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    reorderFolders.mockClear();
    pointerOver = null;
    document.elementFromPoint = () => (pointerOver ? row(pointerOver) : null);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<ConnectionsPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.elementFromPoint = elementFromPoint;
  });

  it("moves a folder dropped on another folder and saves the order once", () => {
    const press = pointer("pointerdown", grip("a"));
    expect(press.defaultPrevented).toBe(true);

    pointerOver = "b";
    pointer("pointermove", window);
    expect(row("b").className).toContain(LINE_BELOW);
    pointerOver = "c";
    pointer("pointermove", window);
    expect(row("a").className).toContain("opacity-60");
    // The line under C shows A will land below it.
    expect(row("c").className).toContain(LINE_BELOW);
    expect(row("b").className).not.toContain(LINE_BELOW);

    pointer("pointerup", window);

    expect(reorderFolders).toHaveBeenCalledTimes(1);
    expect(reorderFolders).toHaveBeenCalledWith(["b", "c", "a"]);
    expect(
      [...host.querySelectorAll("[data-connection-folder-id]")].map((el) =>
        el.getAttribute("data-connection-folder-id"),
      ),
    ).toEqual(["b", "c", "a"]);
    expect(row("a").className).not.toContain("opacity-60");
    expect(row("c").className).not.toContain(LINE_BELOW);
  });

  it("moves a folder up with touch, landing above the target", () => {
    pointer("pointerdown", grip("c"), "touch");
    pointerOver = "a";
    pointer("pointermove", window, "touch");
    expect(row("a").className).toContain(LINE_ABOVE);
    expect(row("a").className).not.toContain(LINE_BELOW);
    pointer("pointerup", window, "touch");

    expect(reorderFolders).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("keeps the order when released over itself, outside the list, or cancelled", () => {
    pointer("pointerdown", grip("a"));
    pointerOver = "a";
    pointer("pointermove", window);
    pointer("pointerup", window);

    pointer("pointerdown", grip("a"));
    pointerOver = "b";
    pointer("pointermove", window);
    pointerOver = null;
    pointer("pointermove", window);
    pointer("pointerup", window);

    pointer("pointerdown", grip("a"));
    pointerOver = "c";
    pointer("pointermove", window);
    pointer("pointercancel", window);

    expect(reorderFolders).not.toHaveBeenCalled();
    expect(row("c").className).not.toContain(LINE_BELOW);
  });

  it("no longer depends on framer-motion", () => {
    expect(readFileSync(join(currentDir, "ConnectionsPanel.tsx"), "utf8")).not.toMatch(/from "framer-motion"/);
  });
});

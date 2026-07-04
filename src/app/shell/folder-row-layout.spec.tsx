import { act } from "react";
import type { ComponentType, ElementType, ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderHeaderRow } from "./ChatSidebar";

vi.mock("framer-motion", () => ({
  Reorder: {
    Item: ({
      as: Component = "div",
      children,
      dragControls,
      dragListener,
      value,
      ...props
    }: {
      as?: ElementType;
      children: ReactNode;
      dragControls?: unknown;
      dragListener?: boolean;
      value?: unknown;
    }) => <Component {...props}>{children}</Component>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return { container, root };
}

function expectCompactFolderHeader(container: HTMLElement, folderName: string, count: string) {
  const dragHandle = container.querySelector(".cursor-grab");
  expect(dragHandle?.className).toContain("shrink-0");
  expect(dragHandle?.className).not.toContain("max-md:opacity-100");

  const label = Array.from(container.querySelectorAll("span")).find((element) => element.textContent === folderName);
  expect(label?.className).toContain("min-w-0");

  const countBadge = Array.from(container.querySelectorAll("span")).find((element) => element.textContent === count);
  expect(countBadge?.className).toContain("shrink-0");
}

describe("chat folder row layout", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("keeps conversation folder affordances from shrinking into the label", () => {
    expect(FolderHeaderRow satisfies ComponentType<Parameters<typeof FolderHeaderRow>[0]>).toBeTypeOf("function");

    const rendered = render(
      <FolderHeaderRow
        folder={{
          id: "folder-1",
          name: "Deki Circus With A Very Long Name",
          mode: "conversation",
          color: "#ef4444",
          sortOrder: 0,
          collapsed: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
        entriesCount={6}
        style={{}}
        isDropTarget={false}
        draggedChatId={null}
        onToggleCollapse={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onChatDragOver={() => undefined}
        onChatDragLeave={() => undefined}
        onChatDrop={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expectCompactFolderHeader(container, "Deki Circus With A Very Long Name", "6");
  });
});

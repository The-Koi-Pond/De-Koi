import { act } from "react";
import type { ComponentType, ElementType, ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionFolderRow, DefaultAgentConnectionCard } from "./ConnectionsPanel";

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

describe("connection folder row layout", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("keeps connection folder affordances from shrinking into the label", () => {
    expect(ConnectionFolderRow satisfies ComponentType<Parameters<typeof ConnectionFolderRow>[0]>).toBeTypeOf(
      "function",
    );

    const rendered = render(
      <ConnectionFolderRow
        folder={{
          id: "folder-1",
          name: "Local Models With A Very Long Name",
          color: "#38bdf8",
          sortOrder: 0,
          collapsed: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
        entries={[
          {
            id: "connection-1",
            name: "Local",
            provider: "custom",
            model: "local",
          },
        ]}
        renderConnectionRow={() => <div />}
        isDropTarget={false}
        draggedConnectionId={null}
        onToggleCollapse={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onConnectionDragOver={() => undefined}
        onConnectionDragLeave={() => undefined}
        onConnectionDrop={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expectCompactFolderHeader(container, "Local Models With A Very Long Name", "1");
  });

  it("explains how to choose the default agent connection", () => {
    const rendered = render(
      <DefaultAgentConnectionCard
        connectionsList={[{ id: "connection-1", name: "Primary", provider: "openai", model: "model-a" }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).toContain("Choose a text connection below, then enable Use as default agent connection");
  });
});

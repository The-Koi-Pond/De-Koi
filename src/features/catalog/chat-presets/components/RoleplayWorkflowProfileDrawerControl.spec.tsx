import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./RoleplayWorkflowProfileChooser", () => ({
  RoleplayWorkflowProfileChooser: () => <div data-testid="workflow-chooser">Chooser open</div>,
}));

import type { Chat } from "../../../../engine/contracts/types/chat";
import { RoleplayWorkflowProfileDrawerControl } from "./RoleplayWorkflowProfileDrawerControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chat = { id: "roleplay-chat", mode: "roleplay", metadata: {} } as Chat;

describe("RoleplayWorkflowProfileDrawerControl", () => {
  let root: Root;
  const container = document.createElement("div");

  afterEach(() => {
    act(() => root?.unmount());
    container.replaceChildren();
  });

  it("expands the chooser when the discovery lifecycle reveals its destination", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileDrawerControl chat={chat} revealFromDiscovery={false} />);
    });
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="workflow-chooser"]')).toBeNull();

    await act(async () => {
      root.render(<RoleplayWorkflowProfileDrawerControl chat={chat} revealFromDiscovery />);
    });
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Chooser open");
  });
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../../../shared/stores/agent.store";
import { AgentThoughtBubbles } from "./AgentThoughtBubbles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentThoughtBubbles", () => {
  let container: HTMLDivElement;
  let root: Root;

  const bubble = (name: string) =>
    [...container.querySelectorAll<HTMLElement>("div.rounded-md")].find((el) => el.textContent?.includes(name));

  beforeEach(() => {
    vi.useFakeTimers();
    useAgentStore.setState({
      isProcessing: false,
      thoughtBubbles: [
        { agentId: "tracker", agentName: "Tracker", content: "Updated the scene.", timestamp: 1 },
        { agentId: "director", agentName: "Director", content: "Raised the stakes.", timestamp: 2 },
      ],
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AgentThoughtBubbles />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useAgentStore.setState({ thoughtBubbles: [] } as never);
    vi.useRealTimers();
  });

  it("slides a dismissed bubble out before removing it and leaves the others", () => {
    act(() => bubble("Tracker")!.querySelector("button")!.click());

    expect(bubble("Tracker")?.className).toContain("motion-exit");
    expect(bubble("Director")?.className).toContain("motion-enter");

    act(() => vi.advanceTimersByTime(200));

    expect(bubble("Tracker")).toBeUndefined();
    expect(bubble("Director")).toBeDefined();
  });
});

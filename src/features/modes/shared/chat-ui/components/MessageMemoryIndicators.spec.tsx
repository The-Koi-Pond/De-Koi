import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MessageExtra } from "../../../../../engine/contracts/types/chat";
import { MessageMemoryIndicators } from "./MessageMemoryIndicators";

describe("MessageMemoryIndicators", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("shows a visible partial-capture warning when consequence details are malformed", () => {
    const memoryCapture = {
      status: "completed",
      jobId: "job-1",
      sourceMessageIds: ["user-1", "assistant-1"],
      completedAt: "2026-07-20T00:00:00.000Z",
      consequences: {
        status: "completed",
        affected: [
          {
            operation: "created",
            memory: { id: "memory-1", kind: "fact", status: "active", content: "" },
          },
        ],
      },
    } as unknown as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("partial memory");
    act(() => button?.click());
    expect(container.textContent).toContain("Some memory details could not be saved or verified.");
  });
});

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

  it.each([
    ["missing kind", { id: "memory-2", status: "active", content: "Miso is a cat." }],
    ["invalid kind", { id: "memory-2", kind: "legacy", status: "active", content: "Miso is a cat." }],
    ["non-consequence kind", { id: "memory-2", kind: "episode", status: "active", content: "Miso is a cat." }],
    ["missing status", { id: "memory-2", kind: "fact", content: "Miso is a cat." }],
    ["invalid status", { id: "memory-2", kind: "fact", status: "corrupt", content: "Miso is a cat." }],
    ["mismatched superseded status", { id: "memory-2", kind: "fact", status: "superseded", content: "Miso is a cat." }],
    ["blank content", { id: "memory-2", kind: "fact", status: "active", content: "" }],
  ])("shows a visible partial-capture warning for a mixed valid and %s consequence", (_label, malformed) => {
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
            memory: { id: "memory-1", kind: "fact", status: "active", content: "The user's cat is Miso." },
          },
          {
            operation: "created",
            memory: malformed,
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

  it("labels a total malformed capture as unavailable instead of partial", () => {
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
            memory: { id: "memory-1", kind: "legacy", status: "active", content: "Looks plausible." },
          },
        ],
      },
    } as unknown as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("memory unavailable");
    expect(button?.textContent).not.toContain("partial memory");
    act(() => button?.click());
    expect(container.textContent).toContain("No memory details could be saved or verified.");
  });

  it("does not count an invalid operation as a saved consequence", () => {
    const memoryCapture = {
      status: "completed",
      jobId: "job-1",
      sourceMessageIds: ["user-1", "assistant-1"],
      completedAt: "2026-07-20T00:00:00.000Z",
      consequences: {
        status: "completed",
        affected: [
          {
            operation: "merged",
            memory: { id: "memory-1", kind: "fact", status: "active", content: "The user's cat is Miso." },
          },
        ],
      },
    } as unknown as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    expect(container.querySelector("button")?.textContent).toContain("memory unavailable");
  });

  it.each([
    [
      "partial memory",
      {
        operation: "created",
        memory: { id: "transcript-1", content: "User: My cat is Miso." },
      },
    ],
    ["memory unavailable", undefined],
  ])("distinguishes a skipped consequence stage with and without a saved transcript as %s", (label, capture) => {
    const memoryCapture = {
      status: "completed",
      jobId: "job-1",
      sourceMessageIds: ["user-1", "assistant-1"],
      completedAt: "2026-07-20T00:00:00.000Z",
      ...(capture ? { capture } : {}),
      consequences: {
        status: "skipped",
        skipReason: "llm_gateway_unavailable",
        affected: [],
      },
    } as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    expect(container.querySelector("button")?.textContent).toContain(label);
  });

  it.each([
    ["processing", "remembering", "De-Koi is checking this exchange for durable memory."],
    ["retryable", "memory retrying", "Memory capture hit a temporary problem and will retry automatically."],
    [
      "failed",
      "memory unavailable",
      "Memory capture could not finish after several attempts. The conversation reply is still safe.",
    ],
  ] as const)("shows a safe %s lifecycle state", (status, label, detail) => {
    const memoryCapture = {
      status,
      jobId: "job-1",
      sourceMessageIds: ["user-1", "assistant-1"],
      attempts: status === "processing" ? 1 : 3,
      updatedAt: "2026-07-20T00:00:00.000Z",
      ...(status === "failed" ? { failureCategory: "capture_unavailable" } : {}),
    } as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain(label);
    act(() => button?.click());
    expect(container.textContent).toContain(detail);
    expect(container.textContent).not.toContain("provider unavailable");
  });

  it("does not present an unknown persisted capture status as remembered", () => {
    const memoryCapture = {
      status: "legacy_unknown",
      jobId: "job-1",
      sourceMessageIds: ["user-1", "assistant-1"],
    } as unknown as MessageExtra["memoryCapture"];

    act(() => {
      root = createRoot(container);
      root.render(<MessageMemoryIndicators memoryCapture={memoryCapture} />);
    });

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("remembered");
  });
});

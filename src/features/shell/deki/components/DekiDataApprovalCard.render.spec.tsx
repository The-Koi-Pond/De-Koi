import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DekiWorkspaceHistoryEntry, DekiWorkspacePendingApproval } from "../../../../engine/deki/deki-entry";
import { DekiDataApprovalCard } from "./DekiDataApprovalCard";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

const entry: DekiWorkspaceHistoryEntry = {
  id: "deki-approval-1",
  sessionId: "session-1",
  command: "deki data delete characters/char-mei",
  reason: "Retire Mei",
  status: "dry-run",
  operationHash: "sha256:abc",
  affectedEntities: { characters: 1, "character-gallery": 1, "canonical-memories": 1 },
  affectedRows: 3,
  validationStatus: "passed",
  journalPath: null,
  createdAt: "2026-09-30T12:00:00.000Z",
  completedAt: null,
};

function pending(expiresAt: string): DekiWorkspacePendingApproval {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    command: entry.command,
    reason: "Retire Mei",
    operationHash: "sha256:abc",
    requestedAt: "2026-09-30T12:00:00.000Z",
    expiresAt,
    affectedEntities: entry.affectedEntities,
    affectedRows: entry.affectedRows,
    validationStatus: "passed",
    diffPreview: [
      { entity: "characters", id: "char-mei", action: "delete", before: { data: { name: "Mei" } } },
      {
        entity: "character-gallery",
        id: "img-1",
        action: "delete",
        before: { id: "img-1", filename: "mei-1.png" },
        effect: "gallery image deleted with the character",
      },
      {
        entity: "canonical-memories",
        id: "mem-1",
        action: "update",
        before: { id: "mem-1", title: "Brass key" },
        after: { id: "mem-1", title: "Brass key" },
        effect: "memory moved to deleted",
      },
    ],
    diffTruncated: false,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

function render(approval: DekiWorkspacePendingApproval | null) {
  act(() => {
    root!.render(
      <DekiDataApprovalCard
        entry={entry}
        pending={approval}
        availability="ready"
        deciding={false}
        onDecide={() => {}}
      />,
    );
  });
}

function buttons(): string[] {
  return Array.from(container!.querySelectorAll("button")).map((button) => button.textContent ?? "");
}

describe("DekiDataApprovalCard", () => {
  it("drops its decision buttons at expiry without a parent update", () => {
    render(pending("2026-09-30T12:01:30.000Z"));
    expect(buttons()).toEqual(["Reject", "Delete"]);
    expect(container!.textContent).toContain("Expires in 1 min");

    act(() => vi.advanceTimersByTime(30_001));
    expect(container!.textContent).toContain("Expires in under a minute");
    expect(buttons()).toEqual(["Reject", "Delete"]);

    act(() => vi.advanceTimersByTime(60_000));
    expect(buttons()).toEqual([]);
    expect(container!.textContent).toContain("Expired");
  });

  it("renders an already expired approval as history, not as pending", () => {
    render(pending("2026-09-30T11:59:00.000Z"));

    expect(buttons()).toEqual([]);
    expect(container!.textContent).toContain("Expired");
    expect(container!.textContent).not.toContain("Waiting for your approval");
  });

  it("separates deleted and changed side effects and says what happens to each", () => {
    render(pending("2026-09-30T12:30:00.000Z"));

    const text = container!.textContent ?? "";
    expect(text).toContain("Also deleted");
    expect(text).toContain("character gallery image: mei-1.png · gallery image deleted with the character");
    expect(text).toContain("Also changed");
    expect(text).toContain("memory: Brass key · memory moved to deleted");
    expect(text).toContain("1 character, 1 character gallery image, 1 memory");
  });
});

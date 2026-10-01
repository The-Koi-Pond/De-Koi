import { describe, expect, it } from "vitest";
import type { DekiWorkspacePendingApproval } from "../../../../engine/deki/deki-entry";
import {
  EMPTY_DEKI_LIVE_ACTIVITY,
  dekiTraceSteps,
  describeDekiStep,
  reduceDekiLiveActivity,
  type DekiLiveActivity,
} from "./deki-workspace-activity";

const approval: DekiWorkspacePendingApproval = {
  id: "deki-approval-1",
  sessionId: "session-1",
  command: "deki data delete lorebook-entries/entry-koi",
  reason: "Duplicate",
  operationHash: "sha256:abc",
  requestedAt: "2026-06-25T12:00:00.000Z",
  expiresAt: "2026-06-25T12:30:00.000Z",
  affectedEntities: { "lorebook-entries": 1 },
  affectedRows: 1,
  validationStatus: "passed",
  diffPreview: [],
  diffTruncated: false,
};

describe("reduceDekiLiveActivity", () => {
  it("pairs tool ends with their starts and keeps the latest narration", () => {
    let state: DekiLiveActivity = EMPTY_DEKI_LIVE_ACTIVITY;
    state = reduceDekiLiveActivity(state, { type: "status", data: { content: "Checking.", kind: "info" } });
    state = reduceDekiLiveActivity(state, {
      type: "tool_start",
      data: { id: "a", name: "grep", input: { query: "x" } },
    });
    state = reduceDekiLiveActivity(state, {
      type: "tool_start",
      data: { id: "b", name: "read", input: { path: "a.ts" } },
    });
    state = reduceDekiLiveActivity(state, { type: "tool_end", data: { id: "a", isError: true, output: "boom" } });

    expect(state.narration).toBe("Checking.");
    expect(state.steps.map((step) => [step.id, step.status])).toEqual([
      ["a", "error"],
      ["b", "running"],
    ]);
    expect(state.steps[0]!.output).toBe("boom");
  });

  it("closes the latest running step when an end event has no id", () => {
    let state = reduceDekiLiveActivity(EMPTY_DEKI_LIVE_ACTIVITY, { type: "tool_start", data: { name: "ls" } });
    state = reduceDekiLiveActivity(state, { type: "tool_end", data: { isError: false } });

    expect(state.steps[0]!.status).toBe("done");
  });

  it("ignores end events for unknown steps and duplicate approvals", () => {
    let state = reduceDekiLiveActivity(EMPTY_DEKI_LIVE_ACTIVITY, {
      type: "tool_end",
      data: { id: "missing", isError: false },
    });
    expect(state).toBe(EMPTY_DEKI_LIVE_ACTIVITY);
    state = reduceDekiLiveActivity(state, { type: "approval_pending", data: approval });
    const again = reduceDekiLiveActivity(state, { type: "approval_pending", data: approval });

    expect(again).toBe(state);
    expect(again.approvals).toHaveLength(1);
  });

  it("flags a retry without replacing the narration", () => {
    let state = reduceDekiLiveActivity(EMPTY_DEKI_LIVE_ACTIVITY, { type: "status", data: "Reading owners." });
    state = reduceDekiLiveActivity(state, { type: "status", data: { content: "Retrying.", kind: "retry" } });

    expect(state.retrying).toBe(true);
    expect(state.narration).toBe("Reading owners.");
  });
});

describe("describeDekiStep", () => {
  it("describes commands in plain language", () => {
    expect(describeDekiStep("grep", { query: "AppShell", path: "src/app" })).toBe(
      'Searched code for "AppShell" in src/app',
    );
    expect(describeDekiStep("read_deki_code_file", { path: "AGENTS.md" })).toBe("Read AGENTS.md");
    expect(describeDekiStep("deki_data", { action: "patch", collection: "personas", id: "p1" })).toBe(
      "Drafted an edit to persona p1 for approval",
    );
    expect(describeDekiStep("deki_data", { action: "list", collection: "lorebook-entries" })).toBe(
      "Listed lorebook entries",
    );
    expect(describeDekiStep("deki_data", { action: "get", collection: "lorebooks", id: "book-pond" })).toBe(
      "Opened lorebook book-pond",
    );
    expect(describeDekiStep("read_deki_web_page", { url: "https://example.com/wiki/Koi" })).toBe("Read example.com");
  });
});

describe("dekiTraceSteps", () => {
  it("keeps only command steps and marks a step its turn cut off as interrupted, not done", () => {
    const steps = dekiTraceSteps([
      { type: "status", content: "Checking." },
      { type: "tool", tool: { id: "a", name: "ls", status: "running", input: { path: "src" } } },
      { type: "tool", tool: { id: "b", name: "grep", status: "error", output: "bad args" } },
      { type: "tool", tool: { id: "c", name: "read", status: "done", input: { path: "a.ts" } } },
    ]);

    expect(steps.map((step) => [step.id, step.status])).toEqual([
      ["a", "interrupted"],
      ["b", "error"],
      ["c", "done"],
    ]);
  });
});

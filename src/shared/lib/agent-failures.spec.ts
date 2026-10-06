import { describe, expect, it } from "vitest";

import { latestTurnAgentFailures, type PersistedAgentRun } from "./agent-failures";

const run = (overrides: Partial<PersistedAgentRun>): PersistedAgentRun => ({
  agentType: "world-state",
  agentName: "World State",
  messageId: "m2",
  success: true,
  error: null as string | null,
  createdAt: "2026-10-05T21:37:00.000Z",
  ...overrides,
});

describe("latestTurnAgentFailures", () => {
  it("restores failures from the newest turn with their persisted names and reasons", () => {
    const failures = latestTurnAgentFailures([
      run({ agentType: "continuity", agentName: "Continuity Checker", createdAt: "2026-10-05T21:37:01.000Z" }),
      run({ success: false, error: "Provider returned HTTP 403 Forbidden", createdAt: "2026-10-05T21:37:02.000Z" }),
    ]);

    expect(failures).toEqual([
      {
        agentType: "world-state",
        agentName: "World State",
        error: "Provider returned HTTP 403 Forbidden",
        reasonLabel: "Authentication",
      },
    ]);
  });

  it("ignores failures from earlier turns", () => {
    expect(
      latestTurnAgentFailures([
        run({ messageId: "m1", success: false, error: "timeout", createdAt: "2026-10-05T21:30:00.000Z" }),
        run({ messageId: "m2", agentType: "continuity", createdAt: "2026-10-05T21:37:00.000Z" }),
      ]),
    ).toEqual([]);
  });

  it("lets a later successful retry on the same turn clear the failure", () => {
    expect(
      latestTurnAgentFailures([
        run({ success: false, error: "timeout", createdAt: "2026-10-05T21:37:00.000Z" }),
        run({ success: true, createdAt: "2026-10-05T21:38:00.000Z" }),
      ]),
    ).toEqual([]);
  });

  it("skips rows without an agent type or message instead of inventing failures", () => {
    expect(
      latestTurnAgentFailures([run({ agentType: " ", success: false }), run({ messageId: "", success: false })]),
    ).toEqual([]);
  });
});

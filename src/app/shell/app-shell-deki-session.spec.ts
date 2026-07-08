import { describe, expect, it } from "vitest";

import { shouldRequestDekiSessionSelect } from "./app-shell-deki-session";

describe("shouldRequestDekiSessionSelect", () => {
  it("does not request storage selection for the active visible Deki session", () => {
    expect(
      shouldRequestDekiSessionSelect({
        sessionId: "deki-1",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: null,
      }),
    ).toBe(false);
  });

  it("does not request duplicate selection while the same session is pending", () => {
    expect(
      shouldRequestDekiSessionSelect({
        sessionId: "deki-2",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: "deki-2",
      }),
    ).toBe(false);
  });

  it("requests selection for a different non-pending session", () => {
    expect(
      shouldRequestDekiSessionSelect({
        sessionId: "deki-2",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: null,
      }),
    ).toBe(true);
  });
});

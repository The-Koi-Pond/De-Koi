import { describe, expect, it } from "vitest";

import { getDekiSessionSelectAction, shouldRequestDekiSessionSelect } from "./app-shell-deki-session";

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

describe("getDekiSessionSelectAction", () => {
  it("opens an already active visible Deki session without another storage selection", () => {
    expect(
      getDekiSessionSelectAction({
        sessionId: "deki-1",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: null,
      }),
    ).toBe("open-active");
  });

  it("ignores duplicate clicks while that session selection is already pending", () => {
    expect(
      getDekiSessionSelectAction({
        sessionId: "deki-2",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: "deki-2",
      }),
    ).toBe("ignore-pending");
  });

  it("selects a different non-pending session", () => {
    expect(
      getDekiSessionSelectAction({
        sessionId: "deki-2",
        activeSessionId: "deki-1",
        dekiOpen: true,
        pendingSessionId: null,
      }),
    ).toBe("select");
  });
});

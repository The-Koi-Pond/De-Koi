import { describe, expect, it } from "vitest";
import {
  deriveSetupJourneyAction,
  isSetupReady,
  type SetupJourneyIntent,
  type SetupReadinessFacts,
} from "./setup-journey";

const intent = (mode: SetupJourneyIntent["mode"], completed = false): SetupJourneyIntent => ({
  journeyId: `journey-${mode}`,
  mode,
  originCharacterId: null,
  selectedConnectionId: null,
  dismissed: false,
  completed,
});

const webFacts = (overrides: Partial<SetupReadinessFacts> = {}): SetupReadinessFacts => ({
  environment: "web",
  runtimeUrl: "https://runtime.example",
  runtimeHealth: "healthy",
  usableConnectionCount: 1,
  selectedConnectionTest: "passed",
  ...overrides,
});

const desktopFacts = (overrides: Partial<SetupReadinessFacts> = {}): SetupReadinessFacts => ({
  environment: "embedded",
  runtimeUrl: null,
  runtimeHealth: "not-required",
  usableConnectionCount: 1,
  selectedConnectionTest: "passed",
  ...overrides,
});

describe("setup journey model", () => {
  it("configures a missing web runtime", () => {
    expect(deriveSetupJourneyAction(webFacts({ runtimeUrl: "" }), intent("game"))).toBe("configure-runtime");
  });

  it("repairs an unhealthy web runtime", () => {
    expect(deriveSetupJourneyAction(webFacts({ runtimeHealth: "error" }), intent("game"))).toBe("repair-runtime");
  });

  it.each(["unknown", "not-required"] as const)(
    "does not advance past a configured but %s web runtime",
    (runtimeHealth) => {
      expect(deriveSetupJourneyAction(webFacts({ runtimeHealth }), intent("game"))).toBe("repair-runtime");
      expect(isSetupReady(webFacts({ runtimeHealth }))).toBe(false);
    },
  );

  it("creates a connection when desktop has none", () => {
    expect(deriveSetupJourneyAction(desktopFacts({ usableConnectionCount: 0 }), intent("roleplay"))).toBe(
      "create-connection",
    );
  });

  it("tests the selected desktop connection when required", () => {
    expect(
      deriveSetupJourneyAction(desktopFacts({ selectedConnectionTest: "required" }), intent("conversation")),
    ).toBe("test-connection");
  });

  it("configures chat once infrastructure is ready", () => {
    expect(deriveSetupJourneyAction(desktopFacts(), intent("game"))).toBe("configure-chat");
  });

  it("chooses an experience when ready without intent", () => {
    expect(deriveSetupJourneyAction(desktopFacts(), null)).toBe("choose-experience");
  });

  it("never returns a runtime action on desktop", () => {
    expect(
      deriveSetupJourneyAction(
        desktopFacts({ runtimeUrl: "", runtimeHealth: "error", usableConnectionCount: 0 }),
        intent("game"),
      ),
    ).toBe("create-connection");
  });

  it("returns complete only after completion is explicitly recorded", () => {
    expect(isSetupReady(desktopFacts())).toBe(true);
    expect(deriveSetupJourneyAction(desktopFacts(), intent("game"))).toBe("configure-chat");
    expect(deriveSetupJourneyAction(desktopFacts(), intent("game", true))).toBe("complete");
  });
});

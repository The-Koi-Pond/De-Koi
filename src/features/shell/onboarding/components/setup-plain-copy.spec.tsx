import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SetupJourneyContextBanner } from "./SetupJourneyContextBanner";
import { SetupReadinessChecklist } from "./SetupReadinessChecklist";

// The first-run screens used developer words ("prerequisites", "intended chat", "existing connection editor").
describe("first-run setup copy", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("explains the setup checklist in plain words", () => {
    act(() =>
      root.render(
        <SetupReadinessChecklist
          facts={{ environment: "embedded", runtimeUrl: null, runtimeHealth: "not-required", usableConnectionCount: 0 }}
          onCreateConnection={() => {}}
        />,
      ),
    );
    expect(host.textContent).toContain("Your chat starts as soon as these steps are done.");
    expect(host.textContent).not.toMatch(/prerequisites|intended chat/);
  });

  it("tells the user what to do in the Connections banner", () => {
    act(() => root.render(<SetupJourneyContextBanner owner="connection" mode="conversation" onReturn={() => {}} />));
    expect(host.textContent).toContain("Add one below. Your new conversation starts as soon as it is set up.");
    expect(host.textContent).not.toMatch(/existing connection editor|request is waiting/);
  });
});

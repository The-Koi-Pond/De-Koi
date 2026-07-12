import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupReadinessFacts } from "../../../../engine/onboarding";
import { SetupReadinessChecklist } from "./SetupReadinessChecklist";

const desktop: SetupReadinessFacts = {
  environment: "embedded", runtimeUrl: null, runtimeHealth: "not-required", usableConnectionCount: 0,
  selectedConnectionTest: "not-selected",
};

describe("SetupReadinessChecklist", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("shows model and experience steps on desktop without a server step", () => {
    act(() => root.render(<SetupReadinessChecklist facts={desktop} />));
    expect(container.textContent).toContain("Connect a language model");
    expect(container.textContent).toContain("Choose your experience");
    expect(container.textContent).not.toContain("Connect to your De-Koi server");
  });

  it("puts the server prerequisite before model setup on the web", () => {
    act(() => root.render(<SetupReadinessChecklist facts={{ ...desktop, environment: "web", runtimeHealth: "unknown" }} />));
    expect(container.textContent!.indexOf("Connect to your De-Koi server")).toBeLessThan(container.textContent!.indexOf("Connect a language model"));
  });

  it("collapses after dismiss while leaving a Finish setup action", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<SetupReadinessChecklist facts={desktop} onDismiss={onDismiss} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss setup checklist"]')!.click());
    expect(onDismiss).toHaveBeenCalled();
    act(() => root.render(<SetupReadinessChecklist facts={desktop} dismissed onDismiss={onDismiss} />));
    expect(container.textContent).toContain("Finish setup");
    expect(container.textContent).not.toContain("Choose your experience");
  });

  it("routes runtime and connection actions through owner callbacks", () => {
    const onConfigureRuntime = vi.fn();
    const onCreateConnection = vi.fn();
    act(() => root.render(<SetupReadinessChecklist facts={{ ...desktop, environment: "web", runtimeHealth: "unknown" }} onConfigureRuntime={onConfigureRuntime} onCreateConnection={onCreateConnection} />));
    act(() => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Configure server"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add connection"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onConfigureRuntime).toHaveBeenCalled();
    expect(onCreateConnection).toHaveBeenCalled();
  });
});

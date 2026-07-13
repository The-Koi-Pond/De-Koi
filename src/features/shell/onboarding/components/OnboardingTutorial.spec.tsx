import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../../shared/stores/ui.store";
import { OnboardingTutorial } from "./OnboardingTutorial";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(root: ParentNode, label: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("OnboardingTutorial", () => {
  let appShell: HTMLDivElement;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    useUIStore.setState({ onboardingTourOpen: true });

    appShell = document.createElement("div");
    appShell.dataset.component = "AppShell";
    container = document.createElement("div");
    appShell.appendChild(container);
    document.body.appendChild(appShell);

    await act(async () => {
      root = createRoot(container);
      root.render(<OnboardingTutorial onShellInertResync={vi.fn()} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    appShell.remove();
    useUIStore.setState({ onboardingTourOpen: false });
    vi.restoreAllMocks();
  });

  it("offers clear start and exit controls", async () => {
    expect(findButton(container, "Start tour")).toBeTruthy();
    expect(findButton(container, "Exit tutorial")).toBeTruthy();
    expect(container.querySelector('button[aria-label="Close tutorial"]')).toBeTruthy();

    await act(async () => {
      findButton(container, "Exit tutorial")?.click();
    });

    expect(useUIStore.getState().onboardingTourOpen).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("explains spotlight navigation and exits with Escape", async () => {
    await act(async () => {
      findButton(container, "Start tour")?.click();
    });

    expect(container.textContent).toContain("You don't need to click the highlighted controls.");
    expect(findButton(container, "Next")).toBeTruthy();
    expect(findButton(container, "Exit tutorial")).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(useUIStore.getState().onboardingTourOpen).toBe(false);
  });
});

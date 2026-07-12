import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../ui.store";

describe("optional onboarding tour state", () => {
  beforeEach(() => useUIStore.setState({ hasCompletedOnboarding: false, onboardingTourOpen: false }));

  it("does not open the legacy tour for a first-launch completion default", () => {
    expect(useUIStore.getState().hasCompletedOnboarding).toBe(false);
    expect(useUIStore.getState().onboardingTourOpen).toBe(false);
  });

  it("opens and closes only through the explicit transient tour action", () => {
    useUIStore.getState().setOnboardingTourOpen(true);
    expect(useUIStore.getState().onboardingTourOpen).toBe(true);
    expect(useUIStore.getState().hasCompletedOnboarding).toBe(false);
    useUIStore.getState().setOnboardingTourOpen(false);
    expect(useUIStore.getState().onboardingTourOpen).toBe(false);
  });
});

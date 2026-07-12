import { describe, expect, it } from "vitest";
import { ONBOARDING_TUTORIAL_STEPS } from "./OnboardingTutorial";

describe("optional onboarding tour copy", () => {
  it("hands setup readiness back to the persistent checklist", () => {
    const finalStep = ONBOARDING_TUTORIAL_STEPS.at(-1);

    expect(finalStep?.title).not.toContain("All Set");
    expect(finalStep?.body.toLowerCase()).toContain("readiness checklist");
    expect(finalStep?.body.toLowerCase()).toContain("discover");
  });
});

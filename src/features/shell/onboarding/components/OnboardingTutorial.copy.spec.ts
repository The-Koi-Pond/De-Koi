import { describe, expect, it } from "vitest";
import { ONBOARDING_TUTORIAL_STEPS } from "./OnboardingTutorial";

describe("optional onboarding tour copy", () => {
  it("keeps the optional tour focused on stable interface orientation", () => {
    const titles = ONBOARDING_TUTORIAL_STEPS.map((step) => step.title);

    expect(titles).toHaveLength(5);
    expect(titles).toEqual([
      "Welcome to De-Koi!",
      "Chats Sidebar",
      "Workspace Navigation",
      "Main Workspace",
      "Ready to Explore",
    ]);
    expect(titles).not.toContain("Set Up a Connection");
    expect(titles).not.toContain("Importing from SillyTavern?");
  });

  it("hands setup readiness back to the persistent checklist", () => {
    const finalStep = ONBOARDING_TUTORIAL_STEPS.at(-1);

    expect(finalStep?.title).not.toContain("All Set");
    expect(finalStep?.body.toLowerCase()).toContain("readiness checklist");
    expect(finalStep?.body.toLowerCase()).toContain("discover");
  });
});

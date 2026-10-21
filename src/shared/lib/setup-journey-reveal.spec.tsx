import { afterEach, describe, expect, it, vi } from "vitest";

import { revealSetupJourney, SETUP_JOURNEY_REGION_ID } from "./setup-journey-reveal";

describe("revealSetupJourney", () => {
  afterEach(() => {
    document.getElementById(SETUP_JOURNEY_REGION_ID)?.remove();
  });

  it("scrolls the open checklist into view and focuses it", () => {
    const region = document.createElement("div");
    region.id = SETUP_JOURNEY_REGION_ID;
    region.tabIndex = -1;
    const scrollIntoView = vi.fn();
    region.scrollIntoView = scrollIntoView;
    document.body.appendChild(region);

    expect(revealSetupJourney()).toBe(true);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(document.activeElement).toBe(region);
  });

  it("reports false when no checklist is on screen", () => {
    expect(revealSetupJourney()).toBe(false);
  });
});

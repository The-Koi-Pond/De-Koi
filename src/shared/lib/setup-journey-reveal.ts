/** DOM id of the setup checklist, so other surfaces can bring it into view. */
export const SETUP_JOURNEY_REGION_ID = "setup-readiness-journey";

/** Scrolls the open setup checklist into view and moves focus to it. Returns false when it isn't on screen. */
export function revealSetupJourney(): boolean {
  if (typeof document === "undefined") return false;
  const region = document.getElementById(SETUP_JOURNEY_REGION_ID);
  if (!region) return false;
  region.scrollIntoView({ block: "center", behavior: "smooth" });
  region.focus({ preventScroll: true });
  return true;
}

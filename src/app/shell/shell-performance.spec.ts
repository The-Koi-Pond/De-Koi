import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLikelyLowPowerShellHost, shouldUseLowPowerShellMode, syncShellRootAttributes } from "./shell-performance";

describe("shell performance mode", () => {
  it("treats Raspberry Pi hostnames as low-power shell hosts", () => {
    expect(isLikelyLowPowerShellHost("pi")).toBe(true);
    expect(isLikelyLowPowerShellHost("pi.local")).toBe(true);
    expect(isLikelyLowPowerShellHost("raspberrypi")).toBe(true);
    expect(isLikelyLowPowerShellHost("raspberrypi.local")).toBe(true);
  });

  it("does not apply the host heuristic to unrelated hostnames", () => {
    expect(isLikelyLowPowerShellHost("piano.local")).toBe(false);
    expect(isLikelyLowPowerShellHost("localhost")).toBe(false);
    expect(isLikelyLowPowerShellHost("dekoi.example.test")).toBe(false);
  });

  it("enables low-power mode for slow-update displays even without a Pi hostname", () => {
    expect(shouldUseLowPowerShellMode({ hostname: "localhost", updateSlow: true })).toBe(true);
    expect(shouldUseLowPowerShellMode({ hostname: "localhost", updateSlow: false })).toBe(false);
  });

  it("reports page activity without disturbing low-power shell mode", () => {
    const root = document.createElement("html");

    syncShellRootAttributes(root, { isPageActive: false, lowPowerShellMode: true });
    expect(root.dataset.deKoiPageActivity).toBe("inactive");
    expect(root.dataset.deKoiShellPerformance).toBe("low");

    syncShellRootAttributes(root, { isPageActive: true, lowPowerShellMode: false });
    expect(root.dataset.deKoiPageActivity).toBe("active");
    expect(root.dataset.deKoiShellPerformance).toBeUndefined();
  });

  it("pauses only decorative shell and splash animations while inactive", () => {
    const cssPath = resolve(process.cwd(), "src/styles/globals/04-surfaces-components.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toMatch(
      /\[data-de-koi-page-activity="inactive"\][^{]*y2k-star[^\{]*koi-home-splash-letter[^\{]*\{[^}]*animation-play-state:\s*paused/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { isLikelyLowPowerShellHost, shouldUseLowPowerShellMode } from "./shell-performance";

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
});

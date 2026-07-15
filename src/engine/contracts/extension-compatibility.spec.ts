import { describe, expect, it } from "vitest";
import {
  extensionCompatibilityAllowsActivation,
  extensionCompatibilityStatus,
  isValidExtensionCompatibilityRange,
} from "./extension-compatibility";

describe("extension compatibility", () => {
  it("supports comparator, caret, tilde, alternative, and wildcard ranges", () => {
    expect(extensionCompatibilityStatus(">=1.6.0 <2.0.0", "1.6.1")).toBe("compatible");
    expect(extensionCompatibilityStatus("^1.6.0", "1.9.0")).toBe("compatible");
    expect(extensionCompatibilityStatus("~1.6.0", "1.7.0")).toBe("incompatible");
    expect(extensionCompatibilityStatus(">=2.0.0 || 1.6.x", "1.6.1")).toBe("compatible");
    expect(extensionCompatibilityStatus("*", "1.6.1")).toBe("compatible");
  });

  it("rejects malformed or unsupported range syntax", () => {
    expect(isValidExtensionCompatibilityRange("definitely not a range")).toBe(false);
    expect(isValidExtensionCompatibilityRange(">=1.6")).toBe(false);
    expect(isValidExtensionCompatibilityRange("1.6.0 - 2.0.0")).toBe(false);
  });

  it("requires package manifests, but not legacy files, to declare a matching range", () => {
    expect(extensionCompatibilityAllowsActivation({ source: "file" } as never)).toBe(true);
    expect(extensionCompatibilityAllowsActivation({ source: "package", manifestVersion: 1 } as never)).toBe(false);
    expect(
      extensionCompatibilityAllowsActivation({
        source: "package",
        manifestVersion: 1,
        compatibility: { deKoi: ">=1.6.0 <2.0.0" },
      } as never),
    ).toBe(true);
    expect(
      extensionCompatibilityAllowsActivation({
        source: "package",
        manifestVersion: 1,
        compatibility: { deKoi: ">=2.0.0" },
      } as never),
    ).toBe(false);
  });
});

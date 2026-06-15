import { describe, expect, it } from "vitest";
import { extensionHasRunnableJavaScript, getInitialImportedExtensionEnabled } from "./extension-import";

describe("extension import safety", () => {
  it("keeps imports with runnable JavaScript disabled until explicitly enabled", () => {
    const extension = { js: "console.log('hello')" };

    expect(extensionHasRunnableJavaScript(extension)).toBe(true);
    expect(getInitialImportedExtensionEnabled(extension)).toBe(false);
  });

  it("allows CSS-only imports to start enabled", () => {
    expect(getInitialImportedExtensionEnabled({ js: null })).toBe(true);
    expect(getInitialImportedExtensionEnabled({})).toBe(true);
  });

  it("treats whitespace-only JavaScript as not runnable", () => {
    const extension = { js: " \n\t " };

    expect(extensionHasRunnableJavaScript(extension)).toBe(false);
    expect(getInitialImportedExtensionEnabled(extension)).toBe(true);
  });
});

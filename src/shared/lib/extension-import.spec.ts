import { describe, expect, it } from "vitest";
import {
  buildImportedExtensionInput,
  extensionHasRunnableJavaScript,
  getInitialImportedExtensionEnabled,
} from "./extension-import";

const installedAt = "2026-06-22T12:00:00.000Z";

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

  it("builds a package import payload from manifest entrypoints", () => {
    const result = buildImportedExtensionInput(
      "soft-reading-mode.json",
      JSON.stringify({
        manifestVersion: 1,
        id: "soft-reading-mode",
        name: "Soft Reading Mode",
        description: "Calmer reading.",
        version: "1.0.0",
        compatibility: { deKoi: ">=1.6.0 <2.0.0" },
        permissions: ["ui:styles", "storage:plugin-memory"],
        ui: { slots: ["settings", "overlay"] },
        entrypoints: { css: "body { line-height: 1.65; }", js: null },
      }),
      installedAt,
    );

    expect(result.kind).toBe("package-json");
    expect(result.input).toMatchObject({
      name: "Soft Reading Mode",
      description: "Calmer reading.",
      css: "body { line-height: 1.65; }",
      js: null,
      enabled: true,
      installedAt,
      packageId: "soft-reading-mode",
      packageVersion: "1.0.0",
      manifestVersion: 1,
      compatibility: { deKoi: ">=1.6.0 <2.0.0" },
      permissions: ["ui:styles", "storage:plugin-memory"],
      uiContributions: { slots: ["settings", "overlay"] },
      source: "package",
    });
  });

  it("keeps package imports with JavaScript disabled", () => {
    const result = buildImportedExtensionInput(
      "js-package.json",
      JSON.stringify({
        manifestVersion: 1,
        id: "js-package",
        name: "JS Package",
        version: "1.0.0",
        entrypoints: { js: "console.log('review me')" },
      }),
      installedAt,
    );

    expect(result.input.enabled).toBe(false);
    expect(result.hasRunnableJavaScript).toBe(true);
  });

  it("supports legacy extension json without manifest metadata", () => {
    const result = buildImportedExtensionInput(
      "legacy.json",
      JSON.stringify({ name: "Legacy", description: "Old shape", version: "legacy-note", css: ".x {}", js: null }),
      installedAt,
    );

    expect(result.kind).toBe("legacy-json");
    expect(result.input).toMatchObject({
      name: "Legacy",
      description: "Old shape",
      css: ".x {}",
      js: null,
      enabled: true,
      installedAt,
      source: "file",
    });
    expect(result.input).not.toHaveProperty("packageId");
  });

  it("builds direct css and js file payloads", () => {
    expect(buildImportedExtensionInput("theme.css", "body {}", installedAt).input).toMatchObject({
      name: "theme",
      description: "CSS extension imported from file",
      css: "body {}",
      enabled: true,
      installedAt,
      source: "file",
    });

    expect(buildImportedExtensionInput("tool.js", "console.log(1)", installedAt).input).toMatchObject({
      name: "tool",
      description: "JS extension imported from file",
      js: "console.log(1)",
      enabled: false,
      installedAt,
      source: "file",
    });
  });

  it("rejects package manifests with unsupported permissions or slots", () => {
    expect(() =>
      buildImportedExtensionInput(
        "bad.json",
        JSON.stringify({
          manifestVersion: 1,
          id: "bad",
          name: "Bad",
          version: "1.0.0",
          permissions: ["storage:connections"],
        }),
        installedAt,
      ),
    ).toThrow(/Unsupported extension permission/);

    expect(() =>
      buildImportedExtensionInput(
        "bad-slot.json",
        JSON.stringify({
          manifestVersion: 1,
          id: "bad-slot",
          name: "Bad Slot",
          version: "1.0.0",
          ui: { slots: ["shell-root"] },
        }),
        installedAt,
      ),
    ).toThrow(/Unsupported extension UI slot/);
  });
});

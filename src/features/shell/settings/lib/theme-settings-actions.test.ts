import { describe, expect, it } from "vitest";
import type { Theme } from "../../../../engine/contracts/types/theme";
import {
  buildThemeSaveInput,
  findImportedThemeDuplicate,
  parseThemeImportText,
} from "./theme-settings-actions";

const theme = (overrides: Partial<Theme>): Theme => ({
  id: "theme-1",
  name: "Neon",
  css: ":root { --primary: #ff00aa; }",
  installedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isActive: false,
  ...overrides,
});

describe("theme settings actions", () => {
  it("builds save input with the existing untitled fallback", () => {
    const input = buildThemeSaveInput("   ", "body {}", () => new Date("2026-02-03T04:05:06.000Z"));

    expect(input).toEqual({
      name: "Untitled Theme",
      css: "body {}",
      installedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("parses JSON theme imports with file-name fallbacks", () => {
    expect(parseThemeImportText("cozy.json", JSON.stringify({ css: "html {}", name: "" }))).toEqual({
      name: "cozy",
      css: "html {}",
    });
  });

  it("parses CSS theme imports from raw file text", () => {
    expect(parseThemeImportText("midnight.css", ":root { --background: #000; }")).toEqual({
      name: "midnight",
      css: ":root { --background: #000; }",
    });
  });

  it("detects imported theme duplicates by name and css", () => {
    const duplicate = findImportedThemeDuplicate(
      [theme({ id: "theme-a" }), theme({ id: "theme-b", name: "Other" })],
      { name: "Neon", css: ":root { --primary: #ff00aa; }" },
    );

    expect(duplicate?.id).toBe("theme-a");
  });
});

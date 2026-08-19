import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("GameSurface conditional component boundaries", () => {
  it("loads setup, character-sheet, and widget UI only through lazy imports", () => {
    const source = readFileSync(join(currentDir, "GameSurface.tsx"), "utf8");

    for (const moduleName of ["GameSetupWizard", "GameCharacterSheet", "GameWidgetPanel"]) {
      expect(source).toContain(`import("./${moduleName}")`);
      expect(source).not.toMatch(new RegExp(`import \\{[^}]*${moduleName}[^}]*\\} from "\\./${moduleName}"`));
    }
    expect(source).toContain("prepareSessionWidgetsOpen ? (");
    expect(source).toContain("prepareInitialWidgetsOpen && (");
  });
});
